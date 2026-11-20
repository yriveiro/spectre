import { Effect } from "effect";
import type { Edge } from "./ledger";
import type { Claim } from "./neuron";
import { type Standing, standing } from "./standing";

export type Answer = {
  readonly claims: ReadonlyArray<Claim>;
  readonly edges: ReadonlyArray<Edge>;
  readonly sources: ReadonlyArray<string>;
  readonly problems: ReadonlyArray<string>;
  readonly clipped: boolean;
};

// BM25 constants; lexical match is the robust zero-shot baseline at this scale (BEIR, arXiv:2104.08663).
const K1 = 1.2;
const B = 0.75;

const DAMPING = 0.85;
const HOPS = 2;
const ROUNDS = 20;

const ASSOCIATIVE: ReadonlySet<Edge["kind"]> = new Set([
  "relates",
  "contradicts",
  "derived-from",
]);

const tokenize = (text: string): ReadonlyArray<string> =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);

const headline = (claim: Claim): string =>
  `${claim.kind} ${claim.claim} ${claim.subject.join(" ")}`;

const costOf = (claim: Claim): number =>
  Math.max(1, Math.ceil(`${headline(claim)} ${claim.path}`.length / 4));

const score = (claims: ReadonlyArray<Claim>, query: string): ReadonlyMap<string, number> => {
  const terms = [...new Set(tokenize(query))];
  const docs = claims.map((claim) => ({ id: claim.id, tokens: tokenize(headline(claim)) }));
  const average =
    docs.length === 0 ? 0 : docs.reduce((sum, doc) => sum + doc.tokens.length, 0) / docs.length;
  const out = new Map<string, number>();
  for (const term of terms) {
    const hits = docs.filter((doc) => doc.tokens.includes(term));
    if (hits.length === 0 || average === 0) continue;
    const idf = Math.log(1 + (docs.length - hits.length + 0.5) / (hits.length + 0.5));
    for (const doc of hits) {
      const tf = doc.tokens.filter((token) => token === term).length;
      const norm = (tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * doc.tokens.length) / average));
      out.set(doc.id, (out.get(doc.id) ?? 0) + idf * norm);
    }
  }
  return out;
};

const projectRelevance = (
  raw: ReadonlyMap<string, number>,
  state: Standing,
): ReadonlyMap<string, number> => {
  const out = new Map<string, number>();
  for (const [id, hit] of raw) {
    if (hit <= 0) continue;
    for (const target of state.resolve(id)) {
      out.set(target, Math.max(out.get(target) ?? 0, hit));
    }
  }
  return out;
};

const expandEdge = (edge: Edge, state: Standing): ReadonlyArray<Edge> => {
  if (!ASSOCIATIVE.has(edge.kind) || edge.to === null) return [];
  const rights = state.resolve(edge.to);
  return state.resolve(edge.from).flatMap((from) =>
    rights
      .filter((to) => from !== to)
      .map((to) => (from === edge.from && to === edge.to ? edge : { ...edge, from, to })),
  );
};

const projectEdges = (edges: ReadonlyArray<Edge>, state: Standing): ReadonlyArray<Edge> => {
  const projected: Array<Edge> = [];
  const seen = new Set<string>();
  for (const edge of edges.flatMap((one) => expandEdge(one, state))) {
    const key = `${edge.kind}\0${edge.from}\0${edge.to}\0${edge.why}`;
    if (seen.has(key)) continue;
    seen.add(key);
    projected.push(edge);
  }
  return projected;
};

const buildNeighbours = (
  edges: ReadonlyArray<Edge>,
): ReadonlyMap<string, ReadonlySet<string>> => {
  const neighbours = new Map<string, Set<string>>();
  const link = (from: string, to: string): void => {
    const ends = neighbours.get(from) ?? new Set<string>();
    ends.add(to);
    neighbours.set(from, ends);
  };
  for (const edge of edges) {
    if (edge.to === null) continue;
    link(edge.from, edge.to);
    link(edge.to, edge.from);
  }
  return neighbours;
};

const spreadWithin = (
  seeds: ReadonlyArray<Claim>,
  neighbours: ReadonlyMap<string, ReadonlySet<string>>,
): ReadonlySet<string> => {
  const within = new Set(seeds.map((claim) => claim.id));
  let frontier = [...within];
  for (let hop = 0; hop < HOPS; hop += 1) {
    const next: Array<string> = [];
    for (const id of frontier) {
      for (const other of neighbours.get(id) ?? []) {
        if (within.has(other)) continue;
        within.add(other);
        next.push(other);
      }
    }
    frontier = next;
  }
  return within;
};

const subgraphOf = (
  within: ReadonlySet<string>,
  neighbours: ReadonlyMap<string, ReadonlySet<string>>,
): ReadonlyMap<string, ReadonlyArray<string>> =>
  new Map(
    [...within].map((id) => [
      id,
      [...(neighbours.get(id) ?? [])].filter((end) => within.has(end)),
    ]),
  );

const inflowOf = (
  peers: ReadonlyArray<string>,
  withinPeers: ReadonlyMap<string, ReadonlyArray<string>>,
  rank: ReadonlyMap<string, number>,
): number => {
  let inflow = 0;
  for (const other of peers) {
    const degree = withinPeers.get(other)?.length ?? 0;
    if (degree > 0) inflow += (rank.get(other) ?? 0) / degree;
  }
  return inflow;
};

const pageRank = (
  seeds: ReadonlyArray<Claim>,
  within: ReadonlySet<string>,
  relevant: ReadonlyMap<string, number>,
  neighbours: ReadonlyMap<string, ReadonlySet<string>>,
): ReadonlyMap<string, number> => {
  const withinPeers = subgraphOf(within, neighbours);
  const mass = seeds.reduce((sum, claim) => sum + (relevant.get(claim.id) ?? 0), 0);
  const prior = new Map<string, number>();
  for (const id of within) prior.set(id, 0);
  for (const claim of seeds) prior.set(claim.id, (relevant.get(claim.id) ?? 0) / mass);
  let rank: ReadonlyMap<string, number> = prior;
  for (let round = 0; round < ROUNDS; round += 1) {
    const next = new Map<string, number>();
    for (const [id, peers] of withinPeers) {
      next.set(id, (1 - DAMPING) * (prior.get(id) ?? 0) + DAMPING * inflowOf(peers, withinPeers, rank));
    }
    rank = next;
  }
  return rank;
};

export const recall = (input: {
  readonly claims: ReadonlyArray<Claim>;
  readonly edges: ReadonlyArray<Edge>;
  readonly query: string;
  readonly budget: number;
}): Effect.Effect<Answer> => {
  if (input.claims.length === 0) {
    return Effect.succeed({
      claims: [],
      edges: [],
      sources: [],
      problems: ["cold: 0 claims"],
      clipped: false,
    });
  }

  const state = standing(input.claims, input.edges);
  const problems: Array<string> = [
    ...state.invalidEdges,
    ...state.cycles.map((cycle) => cycle.summary),
  ];
  const associative = projectEdges(state.validEdges, state);
  const relevant = projectRelevance(score(input.claims, input.query), state);
  const seeds = state.active.filter((claim) => (relevant.get(claim.id) ?? 0) > 0);
  if (seeds.length === 0) {
    problems.push(`no match for query "${input.query}"`);
    return Effect.succeed({ claims: [], edges: [], sources: [], problems, clipped: false });
  }

  const neighbours = buildNeighbours(associative);
  const within = spreadWithin(seeds, neighbours);
  const rank = pageRank(seeds, within, relevant, neighbours);
  const rankOf = (id: string): number => rank.get(id) ?? 0;

  // Contract: relevance ranks, recency breaks ties only and never scales a score,
  // so there is no importance field (MemoryBank, arXiv:2305.10250). Seeds carry
  // the query relevance and rank first; spread holds the graph neighbours after.
  const seedIds = new Set(seeds.map((claim) => claim.id));
  const byBm25 = (id: string): number => relevant.get(id) ?? 0;
  const ordered = [...within]
    .map((id) => state.byId.get(id))
    .filter((claim) => claim !== undefined)
    .toSorted(
      (a, b) =>
        (seedIds.has(b.id) ? 1 : 0) - (seedIds.has(a.id) ? 1 : 0) ||
        (seedIds.has(a.id) ? byBm25(b.id) - byBm25(a.id) : rankOf(b.id) - rankOf(a.id)) ||
        (a.at < b.at ? 1 : a.at > b.at ? -1 : 0) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );

  const picked: Array<Claim> = [];
  let used = 0;
  let clipped = false;
  for (const claim of ordered) {
    const cost = costOf(claim);
    if (used + cost > input.budget) {
      clipped = true;
      problems.push(`budget ${input.budget} tokens holds no more: ${claim.id} costs ${cost}`);
      break;
    }
    picked.push(claim);
    used += cost;
  }

  const chosen = new Set(picked.map((claim) => claim.id));
  return Effect.succeed({
    claims: picked,
    edges: associative.filter(
      (edge) => edge.to !== null && chosen.has(edge.from) && chosen.has(edge.to),
    ),
    sources: picked.map((claim) => claim.path),
    problems,
    clipped,
  });
};
