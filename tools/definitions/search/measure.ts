import type { Plugin } from "@opencode/plugin/effect";
import { Session } from "@opencode/schema/session";
import type { Tool } from "@opencode/schema/tool";
import { Effect, Option, Schema, Semaphore, type Scope } from "effect";
import { envOf } from "./apply";
import { decide, type Outcome, type SurfaceAsk } from "./policy";
import { probe } from "./probe";
import { readAsk, shellAsk, subagentAsk } from "./signals";
import { memoryOf, remember } from "./state";

/**
 * The usage record: one small row per session, written on `tool.execute.after`
 * and stored in `ctx.storage` under this plugin's namespace.
 *
 * The namespace is keyed to the plugin id, not to the project
 * (`packages/core/src/plugin/host.ts`, `storage`), so a record names its project
 * and the report reads its own project's key. `decide` never reads this: the
 * record is a measurement, and the only memory it writes is through `remember`.
 */

const CAP = 64;
const PREFIX = "usage:";

export const UsageRecord = Schema.Struct({
  session: Schema.String,
  project: Schema.String,
  parent: Schema.optional(Schema.String),
  lookups: Schema.Number,
  reads: Schema.Number,
  edits: Schema.Number,
  subagents: Schema.Number,
  packed: Schema.Number,
  measured: Schema.Struct({
    delta: Schema.optional(Schema.Number),
    affected: Schema.optional(Schema.Number),
  }),
  outcome: Schema.optional(Schema.Literals(["answered", "empty", "partial", "absent", "refused"])),
});
export type UsageRecord = typeof UsageRecord.Type;

const Store = Schema.Struct({ records: Schema.Array(UsageRecord) });
// The storage value is `Schema.Json`; one schema decodes and encodes the whole
// list, so the reader never guesses at a shape it did not write.
const Stored = Schema.fromJsonString(Store);
const decodeStore = Schema.decodeUnknownOption(Stored);
const encodeStore = Schema.encodeSync(Stored);

const key = (project: string): string => `${PREFIX}${project}`;

/** Every record this project holds, oldest first. An unreadable value reads as no records. */
export const recordsOf = (
  storage: Plugin.Context["storage"],
  project: string,
): Effect.Effect<ReadonlyArray<UsageRecord>> =>
  storage.get(key(project)).pipe(
    Effect.map((raw) => {
      const decoded = Option.getOrUndefined(decodeStore(raw));
      return decoded === undefined ? [] : decoded.records;
    }),
  );

/** One observed event, as the record counts it. */
type Change =
  | { readonly kind: "search"; readonly outcome: Outcome }
  | {
      readonly kind: "ripwire";
      readonly lookup: boolean;
      readonly delta: boolean;
      readonly affected: boolean;
      readonly fanout: boolean;
    }
  | { readonly kind: "read" }
  | { readonly kind: "edit" }
  | { readonly kind: "spawn" };

interface Observed {
  readonly session: Session.ID;
  readonly change: Change;
  readonly child?: Session.ID;
}

interface Observation {
  readonly change: Change;
  readonly ask?: SurfaceAsk<"complete"> | SurfaceAsk<"subagent">;
  readonly child?: Session.ID;
}

const blank = (session: string, project: string, parent?: string): UsageRecord => ({
  session,
  project,
  ...(parent === undefined ? {} : { parent }),
  lookups: 0,
  reads: 0,
  edits: 0,
  subagents: 0,
  packed: 0,
  measured: {},
});

const merged = (record: UsageRecord, change: Change): UsageRecord => {
  switch (change.kind) {
    case "search":
      return { ...record, lookups: record.lookups + 1, outcome: change.outcome };
    case "ripwire": {
      if (!change.lookup) return record;
      return {
        ...record,
        lookups: record.lookups + 1,
        packed: record.packed + (change.fanout ? 1 : 0),
        measured: {
          ...record.measured,
          ...(change.delta ? { delta: record.edits } : {}),
          ...(change.affected ? { affected: record.edits } : {}),
        },
      };
    }
    case "read":
      return { ...record, reads: record.reads + 1 };
    case "edit":
      return { ...record, edits: record.edits + 1 };
    case "spawn":
      return { ...record, subagents: record.subagents + 1 };
  }
};

/**
 * The list after one event: the session's row moves to the end, a spawn seeds
 * its child's row with the parent id the child cannot know, and the oldest row
 * falls off at the cap.
 */
const advance = (
  records: ReadonlyArray<UsageRecord>,
  project: string,
  event: Observed,
): ReadonlyArray<UsageRecord> => {
  const prior = records.find((one) => one.session === event.session) ?? blank(event.session, project);
  const others = records.filter((one) => one.session !== event.session);
  const child =
    event.child === undefined ||
    event.child === event.session ||
    others.some((one) => one.session === event.child)
      ? []
      : [blank(event.child, project, event.session)];
  return [...others, ...child, merged(prior, event.change)].slice(-CAP);
};

// Two sessions can finish a tool call at once, and a read-modify-write on one
// key would drop one of them. `ctx.storage` offers no compare-and-set.
const writes = Semaphore.makeUnsafe(1);

const write = (storage: Plugin.Context["storage"], project: string, event: Observed): Effect.Effect<void> =>
  writes.withPermits(1)(
    Effect.gen(function* () {
      const records = yield* recordsOf(storage, project);
      yield* storage.set(key(project), encodeStore({ records: advance(records, project, event) }));
    }),
  );

const SearchInput = Schema.Struct({
  query: Schema.optional(Schema.String),
  pattern: Schema.optional(Schema.String),
});

const SearchAnswer = Schema.Struct({
  status: Schema.Literals(["answered", "empty", "partial", "absent", "refused"]),
});

const decodeSearchInput = Schema.decodeUnknownOption(SearchInput);
const decodeSearchAnswer = Schema.decodeUnknownOption(SearchAnswer);

/** The `execute.after` event, as far as the record reads it. */
type ToolAfter = {
  readonly tool: string;
  readonly sessionID: Session.ID;
  readonly input: unknown;
} & ({ readonly status: "completed"; readonly result: Tool.Result } | { readonly status: "error" });

const outputOf = (event: ToolAfter): unknown => (event.status === "completed" ? event.result.output : undefined);

const readSearch = (event: ToolAfter): Observation | undefined => {
  const answer = Option.getOrUndefined(decodeSearchAnswer(outputOf(event)));
  if (answer === undefined) return undefined;
  const input = Option.getOrUndefined(decodeSearchInput(event.input));
  const text = input?.pattern ?? input?.query ?? "";
  return {
    ask: { surface: "complete", text, outcome: answer.status },
    change: { kind: "search", outcome: answer.status },
  };
};

const readEvent = (event: ToolAfter, root: string): Observation | undefined => {
  if (event.status !== "completed") return undefined;
  switch (event.tool) {
    case "spectre_search":
      return readSearch(event);
    case "shell": {
      const ask = shellAsk(event.input);
      if (ask === undefined || ask.parsed.kind !== "ripwire") return undefined;
      const { lookup, delta, affected, fanout } = ask.parsed;
      return { change: { kind: "ripwire", lookup, delta, affected, fanout } };
    }
    case "read": {
      const ask = readAsk(event.input, root);
      if (ask === undefined || !ask.code || !ask.insideRoot) return undefined;
      return { change: { kind: "read" } };
    }
    case "edit":
    case "write":
      return { change: { kind: "edit" } };
    case "subagent": {
      const ask = subagentAsk(event.input, outputOf(event));
      if (ask === undefined) return undefined;
      return { change: { kind: "spawn" }, ask, child: Session.ID.make(ask.child) };
    }
    default:
      return undefined;
  }
};

const observe = (ctx: Plugin.Context, event: ToolAfter): Effect.Effect<void> =>
  Effect.gen(function* () {
    const observation = readEvent(event, ctx.location.directory);
    if (observation === undefined) return;

    const health = yield* Effect.promise(() => probe());
    if (health.kind !== "ready") return;

    if (observation.ask !== undefined) {
      const decision = decide(observation.ask, memoryOf(event.sessionID), envOf(health));
      remember(event.sessionID, decision.next);
    }

    yield* write(ctx.storage, ctx.location.project.id, {
      session: event.sessionID,
      change: observation.change,
      ...(observation.child === undefined ? {} : { child: observation.child }),
    });
  });

export const attachMeasure = (ctx: Plugin.Context): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    yield* ctx.tool.hook("execute.after", (event) =>
      observe(ctx, event).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("search measurement failed", { cause }).pipe(Effect.asVoid),
        ),
      ),
    );

    yield* Effect.logInfo("Registered search measurement", { trigger: "tool.execute.after" });
  });
