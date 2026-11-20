import { AbsolutePath } from "@opencode/schema/schema";
import { Effect } from "effect";
import { type Evidence, evidence } from "./evidence";
import { CORTEX_CAP, cortexWindow, headline, newestFirst, tokens } from "./inject";
import { type Edge, ledger } from "./ledger";
import type { Claim } from "./neuron";
import { type Standing, standing } from "./standing";

export type SubjectStatus = {
  readonly path: string;
  readonly missing: boolean;
  readonly commits: number;
  readonly coChange: number;
  readonly lastTouched: string | null;
};

export type NeuronNode = {
  readonly id: string;
  readonly short: string;
  readonly kind: Claim["kind"];
  readonly claim: string;
  readonly body: string | null;
  readonly at: string;
  readonly status: "active" | "superseded" | "demoted";
  readonly demotedUntil: string | null;
  readonly terminals: ReadonlyArray<string>;
  readonly inCortex: boolean;
  readonly cortexRank: number | null;
  readonly tokenCost: number;
  readonly degree: number;
  readonly subjects: ReadonlyArray<SubjectStatus>;
};

export type LatentBridge = {
  readonly from: string;
  readonly to: string;
  readonly shared: ReadonlyArray<string>;
};

export type BrainAnomaly = {
  readonly kind:
    | "missing-subject"
    | "supersedes-fork"
    | "contradiction"
    | "supersedes-cycle"
    | "ledger-problem";
  readonly severity: "high" | "medium";
  readonly summary: string;
  readonly neuronIds: ReadonlyArray<string>;
};

export type BrainSnapshot = {
  readonly projectName: string;
  readonly directory: string;
  readonly totals: {
    readonly total: number;
    readonly active: number;
    readonly superseded: number;
    readonly demoted: number;
    readonly edges: number;
    readonly isolatedActive: number;
    readonly subjects: number;
    readonly missingSubjects: number;
  };
  readonly cortex: {
    readonly budget: number;
    readonly usedTokens: number;
    readonly shownCount: number;
    readonly activeCount: number;
    readonly rendered: string;
  };
  readonly neurons: ReadonlyArray<NeuronNode>;
  readonly edges: ReadonlyArray<Edge>;
  readonly latentBridges: ReadonlyArray<LatentBridge>;
  readonly anomalies: ReadonlyArray<BrainAnomaly>;
};

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/;
const BROAD_SUBJECTS: ReadonlySet<string> = new Set([
  "AGENTS.md",
  "README.md",
  "TODO.md",
  "CHANGELOG.md",
  "package.json",
  "tsconfig.json",
]);

const rankCortex = (activeOrdered: ReadonlyArray<Claim>) => {
  if (activeOrdered.length === 0) {
    return { ranks: new Map<string, number>(), usedTokens: 0, rendered: "" };
  }
  const win = cortexWindow(activeOrdered.map(headline));
  const ranks = new Map<string, number>();
  for (let i = 0; i < win.shown.length; i += 1) {
    const claim = activeOrdered[i];
    if (claim !== undefined) ranks.set(claim.id, i + 1);
  }
  return { ranks, usedTokens: win.usedTokens, rendered: win.text };
};

const readBody = async (claim: Claim): Promise<string | null> => {
  const file = Bun.file(claim.path);
  if (!(await file.exists())) return null;
  const raw = await file.text();
  const stripped = raw.replace(FRONTMATTER, "").trim();
  if (stripped.length === 0 || stripped === claim.claim.trim()) return null;
  return stripped;
};

const buildDegreeMap = (
  claims: ReadonlyArray<Claim>,
  edges: ReadonlyArray<Edge>,
): ReadonlyMap<string, number> => {
  const counts = new Map(claims.map((one) => [one.id, 0]));
  for (const edge of edges) {
    if (edge.kind === "demoted") continue;
    counts.set(edge.from, (counts.get(edge.from) ?? 0) + 1);
    if (edge.to !== null) counts.set(edge.to, (counts.get(edge.to) ?? 0) + 1);
  }
  return counts;
};

const buildDemotedMap = (edges: ReadonlyArray<Edge>): ReadonlyMap<string, string | null> => {
  const out = new Map<string, string | null>();
  for (const edge of edges) {
    if (edge.kind === "demoted" && edge.to === null) out.set(edge.from, edge.until);
  }
  return out;
};

const explicitLinksOf = (edges: ReadonlyArray<Edge>): ReadonlySet<string> => {
  const linked = new Set<string>();
  for (const edge of edges) {
    if (edge.to === null) continue;
    linked.add(`${edge.from}\0${edge.to}`);
    linked.add(`${edge.to}\0${edge.from}`);
  }
  return linked;
};

const subjectIndexOf = (active: ReadonlyArray<Claim>): ReadonlyMap<string, ReadonlySet<string>> => {
  const pathsById = new Map<string, ReadonlySet<string>>();
  for (const claim of active) {
    const specific = claim.subject.filter((path) => !BROAD_SUBJECTS.has(path));
    pathsById.set(claim.id, new Set(specific.length > 0 ? specific : claim.subject));
  }
  return pathsById;
};

const computeLatentBridges = (
  active: ReadonlyArray<Claim>,
  edges: ReadonlyArray<Edge>,
): ReadonlyArray<LatentBridge> => {
  const linked = explicitLinksOf(edges);
  const pathsById = subjectIndexOf(active);
  const bridges: Array<LatentBridge> = [];
  for (let i = 0; i < active.length; i += 1) {
    const left = active[i];
    if (left === undefined) continue;
    const leftPaths = pathsById.get(left.id) ?? new Set<string>();
    for (let j = i + 1; j < active.length; j += 1) {
      const right = active[j];
      if (right === undefined || linked.has(`${left.id}\0${right.id}`)) continue;
      const shared = [...(pathsById.get(right.id) ?? [])].filter((path) => leftPaths.has(path));
      if (shared.length > 0) bridges.push({ from: left.id, to: right.id, shared });
    }
  }
  return bridges;
};

const detectForkAnomalies = (
  claims: ReadonlyArray<Claim>,
  state: Standing,
): ReadonlyArray<BrainAnomaly> => {
  const linked = new Set<string>();
  for (const edge of state.validEdges) {
    if (edge.to === null || edge.kind === "supersedes" || edge.kind === "demoted") continue;
    linked.add(`${edge.from}\0${edge.to}`);
    linked.add(`${edge.to}\0${edge.from}`);
  }
  const activeIds = new Set(state.active.map((one) => one.id));
  const seenKey = new Set<string>();
  const out: Array<BrainAnomaly> = [];

  for (const claim of claims) {
    if (activeIds.has(claim.id)) continue;
    const terminals = [...new Set(state.resolve(claim.id))].toSorted();
    if (terminals.length < 2) continue;
    const allLinked = terminals.every((a, idx) =>
      terminals.slice(idx + 1).every((b) => linked.has(`${a}\0${b}`)),
    );
    if (allLinked) continue;
    const key = terminals.join("|");
    if (seenKey.has(key)) continue;
    seenKey.add(key);
    out.push({
      kind: "supersedes-fork",
      severity: "high",
      summary: `Unreconciled supersedes fork from ${claim.id.slice(0, 8)} leaves ${terminals.length} active claims without a relation.`,
      neuronIds: [claim.id, ...terminals],
    });
  }
  return out;
};

const collectAnomalies = (
  neurons: ReadonlyArray<NeuronNode>,
  claims: ReadonlyArray<Claim>,
  state: Standing,
  ledgerProblems: ReadonlyArray<string>,
  evidenceProblems: ReadonlyArray<string>,
): ReadonlyArray<BrainAnomaly> => {
  const out: Array<BrainAnomaly> = [...detectForkAnomalies(claims, state)];
  for (const edge of state.validEdges) {
    if (edge.kind !== "contradicts" || edge.to === null) continue;
    out.push({
      kind: "contradiction",
      severity: "high",
      summary: `Contradiction edge between ${edge.from.slice(0, 8)} and ${edge.to.slice(0, 8)}: ${edge.why}`,
      neuronIds: [edge.from, edge.to],
    });
  }
  for (const neuron of neurons) {
    const missing = neuron.subjects.filter((one) => one.missing).map((one) => one.path);
    if (missing.length === 0) continue;
    out.push({
      kind: "missing-subject",
      severity: neuron.status === "active" ? "high" : "medium",
      summary: `${neuron.short} (${neuron.status}) references missing path: ${missing.join(", ")}`,
      neuronIds: [neuron.id],
    });
  }
  for (const cycle of state.cycles) {
    out.push({
      kind: "supersedes-cycle",
      severity: "high",
      summary: cycle.summary,
      neuronIds: cycle.neuronIds,
    });
  }
  for (const problem of [...ledgerProblems, ...state.invalidEdges, ...evidenceProblems]) {
    out.push({ kind: "ledger-problem", severity: "medium", summary: problem, neuronIds: [] });
  }
  return out;
};

const mapSubjects = (
  paths: ReadonlyArray<string>,
  byPath: ReadonlyMap<string, Evidence>,
  missing: ReadonlySet<string>,
): ReadonlyArray<SubjectStatus> =>
  paths.map((path) => {
    const row = byPath.get(path);
    return {
      path,
      missing: missing.has(path),
      commits: row?.commits ?? 0,
      coChange: row?.coChange ?? 0,
      lastTouched: row?.lastTouched ?? null,
    };
  });

type NodeInputs = {
  readonly claims: ReadonlyArray<Claim>;
  readonly state: Standing;
  readonly bodies: ReadonlyMap<string, string | null>;
  readonly cortexRanks: ReadonlyMap<string, number>;
  readonly evByPath: ReadonlyMap<string, Evidence>;
  readonly missingSet: ReadonlySet<string>;
};

const buildNeuronNodes = ({
  claims,
  state,
  bodies,
  cortexRanks,
  evByPath,
  missingSet,
}: NodeInputs): ReadonlyArray<NeuronNode> => {
  const activeIds = new Set(state.active.map((one) => one.id));
  const demotedUntil = buildDemotedMap(state.validEdges);
  const degrees = buildDegreeMap(claims, state.validEdges);
  return claims.map((claim) => {
    const status: NeuronNode["status"] = activeIds.has(claim.id)
      ? "active"
      : demotedUntil.has(claim.id)
        ? "demoted"
        : "superseded";
    const rank = cortexRanks.get(claim.id) ?? null;
    return {
      id: claim.id,
      short: claim.id.slice(0, 8),
      kind: claim.kind,
      claim: claim.claim,
      body: bodies.get(claim.id) ?? null,
      at: claim.at,
      status,
      demotedUntil: demotedUntil.get(claim.id) ?? null,
      terminals: state.resolve(claim.id),
      inCortex: rank !== null,
      cortexRank: rank,
      tokenCost: tokens(`- ${headline(claim)}\n`),
      degree: degrees.get(claim.id) ?? 0,
      subjects: mapSubjects(claim.subject, evByPath, missingSet),
    };
  });
};

const buildTotals = (
  neurons: ReadonlyArray<NeuronNode>,
  activeCount: number,
  edgeCount: number,
  subjectCount: number,
  missingCount: number,
): BrainSnapshot["totals"] => ({
  total: neurons.length,
  active: activeCount,
  superseded: neurons.filter((one) => one.status === "superseded").length,
  demoted: neurons.filter((one) => one.status === "demoted").length,
  edges: edgeCount,
  isolatedActive: neurons.filter((one) => one.status === "active" && one.degree === 0).length,
  subjects: subjectCount,
  missingSubjects: missingCount,
});

export const snapshot = (directory: string): Effect.Effect<BrainSnapshot, Error> =>
  Effect.gen(function* () {
    const held = yield* ledger(AbsolutePath.make(directory)).read();
    const state = standing(held.claims, held.edges);
    const allSubjects = [...new Set(held.claims.flatMap((one) => one.subject))];
    const ev = yield* evidence(directory, allSubjects);
    const cortex = rankCortex(state.active.toSorted(newestFirst));
    const bodies = yield* Effect.promise(() =>
      Promise.all(held.claims.map(async (claim) => [claim.id, await readBody(claim)] as const)),
    );
    const neurons = buildNeuronNodes({
      claims: held.claims,
      state,
      bodies: new Map(bodies),
      cortexRanks: cortex.ranks,
      evByPath: new Map(ev.rows.map((row) => [row.path, row])),
      missingSet: new Set(ev.missing),
    });

    return {
      projectName: directory.split(/[\\/]/).filter(Boolean).at(-1) ?? "project",
      directory,
      totals: buildTotals(neurons, state.active.length, state.validEdges.length, allSubjects.length, ev.missing.length),
      cortex: {
        budget: CORTEX_CAP,
        usedTokens: cortex.usedTokens,
        shownCount: cortex.ranks.size,
        activeCount: state.active.length,
        rendered: cortex.rendered,
      },
      neurons,
      edges: state.validEdges,
      latentBridges: computeLatentBridges(state.active, state.validEdges),
      anomalies: collectAnomalies(neurons, held.claims, state, held.problems, ev.problems),
    };
  });
