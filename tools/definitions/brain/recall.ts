import { Effect } from "effect";
import type { Claim } from "./neuron";
import type { Edge } from "./ledger";

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

const SPREADABLE: ReadonlySet<Edge["kind"]> = new Set([
  "relates",
  "supersedes",
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

const score = (
  claims: ReadonlyArray<Claim>,
  query: string,
): ReadonlyMap<string, number> => {
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

  const problems: Array<string> = [];
  const byId = new Map(input.claims.map((claim) => [claim.id, claim]));
  const known = (edge: Edge): boolean =>
    byId.has(edge.from) && (edge.to === null || byId.has(edge.to));
  const wellFormed = (edge: Edge): boolean =>
    known(edge) &&
    (edge.kind === "demoted" ? true : edge.to !== null) &&
    edge.why.length > 0;
  const spreadable = input.edges.filter((edge) => wellFormed(edge) && SPREADABLE.has(edge.kind));
  for (const edge of input.edges) {
    if (wellFormed(edge)) continue;
    const reason = known(edge) && edge.why.length === 0 ? "empty why" : "unknown claim";
    problems.push(`edge ${edge.kind} ${edge.from}->${edge.to ?? "null"} skipped: ${reason}`);
  }

  const relevant = score(input.claims, input.query);
  const seeds = input.claims.filter((claim) => (relevant.get(claim.id) ?? 0) > 0);
  if (seeds.length === 0) {
    problems.push(`no match for query "${input.query}"`);
    return Effect.succeed({ claims: [], edges: [], sources: [], problems, clipped: false });
  }

  const neighbours = new Map<string, Set<string>>();
  const link = (from: string, to: string): void => {
    const ends = neighbours.get(from) ?? new Set<string>();
    ends.add(to);
    neighbours.set(from, ends);
  };
  for (const edge of spreadable) {
    if (edge.to === null) continue;
    link(edge.from, edge.to);
    link(edge.to, edge.from);
  }

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

  const mass = seeds.reduce((sum, claim) => sum + (relevant.get(claim.id) ?? 0), 0);
  const prior = new Map<string, number>();
  for (const id of within) prior.set(id, 0);
  for (const claim of seeds) prior.set(claim.id, (relevant.get(claim.id) ?? 0) / mass);
  let rank = new Map(prior);
  for (let round = 0; round < ROUNDS; round += 1) {
    const next = new Map<string, number>();
    for (const id of within) {
      let inflow = 0;
      for (const other of neighbours.get(id) ?? []) {
        if (!within.has(other)) continue;
        const degree = [...(neighbours.get(other) ?? [])].filter((end) =>
          within.has(end),
        ).length;
        if (degree > 0) inflow += (rank.get(other) ?? 0) / degree;
      }
      next.set(id, (1 - DAMPING) * (prior.get(id) ?? 0) + DAMPING * inflow);
    }
    rank = next;
  }
  const rankOf = (id: string): number => rank.get(id) ?? 0;

  // Contract: relevance ranks, recency breaks ties only and never scales a score,
  // so there is no importance field (MemoryBank, arXiv:2305.10250). Seeds carry
  // the query relevance and rank first; spread holds the graph neighbours after.
  const seedIds = new Set(seeds.map((claim) => claim.id));
  const byBm25 = (id: string): number => relevant.get(id) ?? 0;
  const ordered = [...within]
    .map((id) => byId.get(id))
    .filter((claim) => claim !== undefined)
    .toSorted(
      (a, b) =>
        (seedIds.has(b.id) ? 1 : 0) - (seedIds.has(a.id) ? 1 : 0) ||
        (seedIds.has(a.id) ? byBm25(b.id) - byBm25(a.id) : rankOf(b.id) - rankOf(a.id)) ||
        (a.at < b.at ? 1 : a.at > b.at ? -1 : 0) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );

  const replaced = new Set<string>();
  for (const edge of spreadable) {
    if (edge.kind === "supersedes" && edge.to !== null && within.has(edge.to)) {
      replaced.add(edge.from);
    }
  }

  const picked: Array<Claim> = [];
  let used = 0;
  let clipped = false;
  for (const claim of ordered) {
    if (replaced.has(claim.id)) continue;
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
    edges: spreadable.filter(
      (edge) => edge.to !== null && chosen.has(edge.from) && chosen.has(edge.to),
    ),
    sources: picked.map((claim) => claim.path),
    problems,
    clipped,
  });
};
