import type { Edge } from "./ledger";
import type { Claim } from "./neuron";

export type CycleInfo = {
  readonly summary: string;
  readonly neuronIds: ReadonlyArray<string>;
};

export type Standing = {
  readonly byId: ReadonlyMap<string, Claim>;
  readonly active: ReadonlyArray<Claim>;
  readonly validEdges: ReadonlyArray<Edge>;
  readonly invalidEdges: ReadonlyArray<string>;
  readonly cycles: ReadonlyArray<CycleInfo>;
  readonly resolve: (id: string) => ReadonlyArray<string>;
};

const edgeReason = (byId: ReadonlyMap<string, Claim>, edge: Edge): string | undefined => {
  const endpointsKnown = byId.has(edge.from) && (edge.to === null || byId.has(edge.to));
  if (!endpointsKnown) return "unknown claim";
  if (edge.kind !== "demoted" && edge.to === null) return "unknown claim";
  if (edge.why.trim().length === 0) return "empty why";
  return undefined;
};

const addTarget = (map: Map<string, Set<string>>, from: string, to: string): void => {
  const existing = map.get(from);
  if (existing !== undefined) {
    existing.add(to);
    return;
  }
  map.set(from, new Set([to]));
};

const detectCycles = (supersededBy: ReadonlyMap<string, ReadonlySet<string>>): ReadonlyArray<CycleInfo> => {
  const state = new Map<string, "visiting" | "done">();
  const cycles: Array<CycleInfo> = [];

  const walk = (node: string, trail: ReadonlyArray<string>): void => {
    state.set(node, "visiting");
    for (const next of supersededBy.get(node) ?? []) {
      const mark = state.get(next);
      if (mark === "visiting") {
        const members = trail.slice(trail.indexOf(next));
        cycles.push({
          summary: `supersedes cycle: ${[...members, next].join(" -> ")}`,
          neuronIds: [...new Set(members)],
        });
      } else if (mark === undefined) {
        walk(next, [...trail, next]);
      }
    }
    state.set(node, "done");
  };

  for (const id of supersededBy.keys()) {
    if (state.get(id) === undefined) walk(id, [id]);
  }
  return cycles;
};

const walkSinks = (
  start: string,
  supersededBy: ReadonlyMap<string, ReadonlySet<string>>,
): ReadonlyArray<string> => {
  const visited = new Set<string>([start]);
  const sinks: Array<string> = [];
  let frontier = [...(supersededBy.get(start) ?? [])];

  while (frontier.length > 0) {
    const next: Array<string> = [];
    for (const id of frontier) {
      if (visited.has(id)) continue;
      visited.add(id);
      const children = supersededBy.get(id);
      if (children === undefined) sinks.push(id);
      else next.push(...children);
    }
    frontier = next;
  }
  return sinks;
};

const resolveClaim = (
  id: string,
  supersededBy: ReadonlyMap<string, ReadonlySet<string>>,
  demoted: ReadonlySet<string>,
): ReadonlyArray<string> => {
  if (!supersededBy.has(id)) return demoted.has(id) ? [] : [id];
  return walkSinks(id, supersededBy).filter((sink) => !demoted.has(sink));
};

export const standing = (
  claims: ReadonlyArray<Claim>,
  edges: ReadonlyArray<Edge>,
): Standing => {
  const byId = new Map(claims.map((claim) => [claim.id, claim]));
  const validEdges: Array<Edge> = [];
  const invalidEdges: Array<string> = [];
  const demoted = new Set<string>();
  const supersededBy = new Map<string, Set<string>>();

  for (const edge of edges) {
    const problem = edgeReason(byId, edge);
    if (problem !== undefined) {
      invalidEdges.push(`edge ${edge.kind} ${edge.from}->${edge.to ?? "null"} skipped: ${problem}`);
      continue;
    }
    validEdges.push(edge);
    if (edge.kind === "demoted" && edge.to === null) demoted.add(edge.from);
    if (edge.kind === "supersedes" && edge.to !== null) addTarget(supersededBy, edge.from, edge.to);
  }

  const resolved = new Map(
    claims.map((claim) => [claim.id, resolveClaim(claim.id, supersededBy, demoted)]),
  );

  return {
    byId,
    active: claims.filter((claim) => !demoted.has(claim.id) && !supersededBy.has(claim.id)),
    validEdges,
    invalidEdges,
    cycles: detectCycles(supersededBy),
    resolve: (id: string) => resolved.get(id) ?? [],
  };
};
