import { basename, join } from "node:path";
import { rename } from "node:fs/promises";
import { Cause, Effect, Exit } from "effect";
import { AbsolutePath } from "@opencode/schema/schema";
import { parse, render, type Claim } from "./neuron";

export type Edge = {
  readonly kind: "relates" | "supersedes" | "contradicts" | "derived-from" | "demoted";
  readonly from: string;
  readonly to: string | null;
  readonly why: string;
  readonly at: string;
  readonly until: string | null;
};

export type Draft = {
  readonly kind: Claim["kind"];
  readonly claim: string;
  readonly subject: ReadonlyArray<string>;
};

export type Brain = {
  readonly claims: ReadonlyArray<Claim>;
  readonly edges: ReadonlyArray<Edge>;
  readonly problems: ReadonlyArray<string>;
};

const KINDS: ReadonlySet<string> = new Set([
  "relates",
  "supersedes",
  "contradicts",
  "derived-from",
  "demoted",
]);

const row = (edge: Edge) => ({
  kind: edge.kind,
  from: edge.from,
  to: edge.to,
  why: edge.why,
  at: edge.at,
  until: edge.until,
});

const edgeOf = (line: string): Edge | undefined => {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return undefined;
  }

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const value = raw as Record<string, unknown>;
  const kind: unknown = value.kind;
  const from: unknown = value.from;
  const why: unknown = value.why;
  const to: unknown = value.to ?? null;
  const until: unknown = value.until;

  if (typeof kind !== "string" || !KINDS.has(kind)) return undefined;
  if (typeof from !== "string" || from.length === 0) return undefined;
  if (typeof why !== "string") return undefined;
  if (to !== null && typeof to !== "string") return undefined;
  if (until !== null && until !== undefined && typeof until !== "string") return undefined;

  return {
    kind: kind as Edge["kind"],
    from,
    to: to as string | null,
    why,
    at: typeof value.at === "string" ? value.at : "",
    until: typeof until === "string" ? until : null,
  };
};

const sameRelation = (one: Edge, two: Edge): boolean =>
  one.kind === two.kind &&
  one.from === two.from &&
  one.to === two.to &&
  one.why === two.why &&
  one.until === two.until;

const expired = (until: string | null, now: number): boolean =>
  until !== null && Date.parse(until) <= now;

export const live = (edges: ReadonlyArray<Edge>): ReadonlyArray<Edge> => {
  const now = Date.now();
  return edges.filter((edge) => !expired(edge.until, now));
};

export const ledger = (project: AbsolutePath) => {
  const brain = AbsolutePath.make(join(project, ".spectre", "brain"));
  const neurons = AbsolutePath.make(join(brain, "neurons"));
  const synapses = AbsolutePath.make(join(brain, "synapses.ndjson"));

  const text = (path: AbsolutePath): Effect.Effect<string, Error> =>
    Effect.tryPromise({
      try: async () => {
        const file = Bun.file(path);
        return (await file.exists()) ? await file.text() : "";
      },
      catch: (cause) => new Error(`cannot read ${basename(path)}: ${cause}`),
    });

  const write = (path: AbsolutePath, contents: string): Effect.Effect<void, Error> =>
    Effect.tryPromise({
      try: async () => {
        const tmp = AbsolutePath.make(`${path}.${Bun.randomUUIDv7()}.tmp`);
        await Bun.write(tmp, "");
        const sink = Bun.file(tmp).writer();
        sink.write(contents);
        await sink.flush();
        await sink.end();
        try {
          await rename(tmp, path);
        } catch (cause) {
          await Bun.file(tmp).unlink().catch(() => undefined);
          throw cause;
        }
      },
      catch: (cause) => new Error(`cannot write ${basename(path)}: ${cause}`),
    });

  const notes = (dir: AbsolutePath): Effect.Effect<ReadonlyArray<string>, Error> =>
    Effect.tryPromise({
      try: async () => {
        const found: Array<string> = [];
        try {
          for await (const entry of new Bun.Glob("*.md").scan({ cwd: dir, onlyFiles: true }))
            found.push(entry);
        } catch (cause) {
          if ((cause as { code?: unknown }).code !== "ENOENT") throw cause;
        }
        return found.toSorted();
      },
      catch: (cause) => new Error(`cannot list ${basename(dir)}: ${cause}`),
    });

  const append = (edge: Edge): Effect.Effect<boolean, Error> =>
    Effect.gen(function* () {
      if (edge.why.trim().length === 0)
        return yield* Effect.fail(
          new Error(`a ${edge.kind} edge from ${edge.from} must say why it exists`),
        );

      const current = yield* text(synapses);
      const rows = current
        .split("\n")
        .filter((line) => line.length > 0)
        .map(edgeOf);

      // `until` is part of the identity, so a re-run that reproduces the same window
      // writes nothing while a later call can still give an open relation an end. The
      // superseded line stays on disk, and `live` is what drops it.
      if (rows.some((seen) => seen !== undefined && sameRelation(seen, edge))) return false;

      const head = current.length === 0 || current.endsWith("\n") ? current : `${current}\n`;
      yield* write(synapses, `${head}${JSON.stringify(row(edge))}\n`);
      return true;
    });

  const mint = (draft: Draft): Effect.Effect<Claim, Error> =>
    Effect.gen(function* () {
      const id = Bun.randomUUIDv7();
      const path = AbsolutePath.make(join(neurons, `${id}.md`));
      const claim: Claim = {
        id,
        kind: draft.kind,
        claim: draft.claim,
        subject: draft.subject,
        at: new Date().toISOString(),
        path,
      };
      yield* write(path, render(claim));
      return claim;
    });

  const read = (): Effect.Effect<Brain, Error> =>
    Effect.gen(function* () {
      const problems: Array<string> = [];
      const claims: Array<Claim> = [];
      const names = yield* notes(neurons);

      for (const name of names) {
        const path = AbsolutePath.make(join(neurons, name));
        const outcome = yield* Effect.exit(Effect.flatMap(text(path), (body) => parse(body, path)));
        if (Exit.isSuccess(outcome)) claims.push(outcome.value);
        else problems.push(String(Cause.squash(outcome.cause)));
      }

      const edges: Array<Edge> = [];
      for (const line of (yield* text(synapses)).split("\n")) {
        if (line.length === 0) continue;
        const edge = edgeOf(line);
        if (edge === undefined) problems.push(`${basename(synapses)}: ${line} is not an edge`);
        else edges.push(edge);
      }

      return {
        claims: claims.toSorted((one, two) =>
          one.id < two.id ? -1 : one.id > two.id ? 1 : 0,
        ),
        edges: live(edges),
        problems,
      };
    });

  return { append, mint, read };
};