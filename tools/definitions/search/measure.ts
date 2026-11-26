import type { Plugin } from "@opencode/plugin/effect";
import { Session } from "@opencode/schema/session";
import { Effect, Option, Schema, type Scope, Semaphore } from "effect";
import { isSpectre } from "./agents";
import {
  envOf,
  isShuntAgent,
  needsEndOfWork,
  shuntAfter,
  syncEndOfWork,
  syncEndOfWorkFromMemory,
  type ToolAfter,
} from "./apply";
import { recordLegendSeen } from "./legend";
import { decide, type Health, type Outcome, type SurfaceAsk } from "./policy";
import { probe } from "./probe";
import { sessionScopeOf } from "./root";
import { scope } from "./run";
import { mutateAsk, readAsk, shellAsk, subagentAsk } from "./signals";
import { memories, memoryOf, remember } from "./state";

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

export const ShuntUsage = Schema.Struct({
  bytesRaw: Schema.Number,
  bytesServed: Schema.Number,
  summarized: Schema.Number,
  escalations: Schema.Number,
});
export type ShuntUsage = typeof ShuntUsage.Type;

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
  shunt: Schema.optional(ShuntUsage),
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
  | { readonly kind: "spawn" }
  | {
      readonly kind: "shunt";
      readonly bytesRaw: number;
      readonly bytesServed: number;
      readonly summarized: boolean;
      readonly escalation: boolean;
    };

interface Observed {
  readonly session: Session.ID;
  readonly changes: ReadonlyArray<Change>;
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

const mergeShunt = (
  prev: ShuntUsage | undefined,
  change: Extract<Change, { readonly kind: "shunt" }>,
): ShuntUsage => {
  const base = prev ?? { bytesRaw: 0, bytesServed: 0, summarized: 0, escalations: 0 };
  return {
    bytesRaw: base.bytesRaw + change.bytesRaw,
    bytesServed: base.bytesServed + change.bytesServed,
    summarized: base.summarized + (change.summarized ? 1 : 0),
    escalations: base.escalations + (change.escalation ? 1 : 0),
  };
};

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
    case "shunt":
      return { ...record, shunt: mergeShunt(record.shunt, change) };
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
  const prior =
    records.find((one) => one.session === event.session) ?? blank(event.session, project);
  const others = records.filter((one) => one.session !== event.session);
  const child =
    event.child === undefined ||
    event.child === event.session ||
    others.some((one) => one.session === event.child)
      ? []
      : [blank(event.child, project, event.session)];
  const updated = event.changes.reduce(merged, prior);
  return [...others, ...child, updated].slice(-CAP);
};

// Two sessions can finish a tool call at once, and a read-modify-write on one
// key would drop one of them. `ctx.storage` offers no compare-and-set.
const writes = Semaphore.makeUnsafe(1);

const write = (
  storage: Plugin.Context["storage"],
  project: string,
  event: Observed,
): Effect.Effect<void> =>
  writes.withPermits(1)(
    Effect.gen(function* () {
      const records = yield* recordsOf(storage, project);
      yield* storage.set(key(project), encodeStore({ records: advance(records, project, event) }));
    }),
  );

export const recordCheck = (
  storage: Plugin.Context["storage"] | undefined,
  project: string,
  session: Session.ID,
  affected: boolean = true,
): Effect.Effect<void> =>
  storage === undefined
    ? Effect.void
    : write(storage, project, {
        session,
        changes: [{ kind: "ripwire", lookup: true, delta: true, affected, fanout: false }],
      });

const SearchInput = Schema.Struct({
  query: Schema.optional(Schema.String),
  pattern: Schema.optional(Schema.String),
  expand: Schema.optional(Schema.String),
});

const SearchAnswer = Schema.Struct({
  status: Schema.Literals(["answered", "empty", "partial", "absent", "refused"]),
});

const decodeSearchInput = Schema.decodeUnknownOption(SearchInput);
const decodeSearchAnswer = Schema.decodeUnknownOption(SearchAnswer);

const outputOf = (event: ToolAfter): unknown =>
  event.status === "completed" ? event.result.output : undefined;

const shellTextOf = (event: Extract<ToolAfter, { readonly status: "completed" }>): string => {
  const out = event.result.output;
  if (typeof out === "string" && out !== "") return out;
  if (typeof out === "object" && out !== null) {
    if ("output" in out && typeof out.output === "string" && out.output !== "") return out.output;
    if ("stdout" in out && typeof out.stdout === "string" && out.stdout !== "") return out.stdout;
  }
  const content = event.result.content;
  if (typeof content === "string" && content !== "") return content;
  if (Array.isArray(content)) {
    return content
      .flatMap((part) =>
        typeof part === "object" &&
        part !== null &&
        "text" in part &&
        typeof part.text === "string"
          ? [part.text]
          : [],
      )
      .join("\n");
  }
  return "";
};

const readSearch = (event: ToolAfter): Observation | undefined => {
  const answer = Option.getOrUndefined(decodeSearchAnswer(outputOf(event)));
  if (answer === undefined) return undefined;
  const input = Option.getOrUndefined(decodeSearchInput(event.input));
  const text = input?.expand ?? input?.pattern ?? input?.query ?? "";
  return {
    ask: { surface: "complete", text, outcome: answer.status },
    change: { kind: "search", outcome: answer.status },
  };
};

const readMutate = (event: ToolAfter, root: string): Observation | undefined => {
  const ask = mutateAsk(event.input, event.tool);
  if (ask === undefined || !ask.code || scope(root, ask.path) === undefined) return undefined;
  return { change: { kind: "edit" } };
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
      return readMutate(event, root);
    case "subagent": {
      const ask = subagentAsk(event.input, outputOf(event));
      if (ask === undefined || ask.agent === "nocturna" || ask.agent === "sicko") return undefined;
      // A stock child never writes a row, so a seed would be a tombstone: it
      // inflates the report's session count and takes a slot at the cap.
      const seed = ask.agent !== undefined && isSpectre(ask.agent);
      return {
        change: { kind: "spawn" },
        ask,
        ...(seed ? { child: Session.ID.make(ask.child) } : {}),
      };
    }
    default:
      return undefined;
  }
};

const probeHealth = (): Effect.Effect<Health> =>
  Effect.promise(() => probe()).pipe(
    Effect.catchCause(() => Effect.succeed<Health>({ kind: "absent", why: "probe-failed" })),
  );

const writeChanges = (
  storage: Plugin.Context["storage"],
  project: string,
  session: Session.ID,
  changes: ReadonlyArray<Change>,
  child?: Session.ID,
): Effect.Effect<void> =>
  changes.length === 0
    ? Effect.void
    : write(storage, project, {
        session,
        changes,
        ...(child === undefined ? {} : { child }),
      });

interface ObserveContext {
  readonly root: string;
  readonly health: Health;
  readonly shuntChange?: Change;
}

const applyObservation = (
  ctx: Plugin.Context,
  event: ToolAfter,
  observation: Observation,
  health: Extract<Health, { readonly kind: "ready" }>,
  base: ReadonlyArray<Change>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (
      event.status === "completed" &&
      event.tool === "shell" &&
      observation.change.kind === "ripwire"
    ) {
      const text = shellTextOf(event);
      if (text !== "") {
        yield* Effect.promise(() => recordLegendSeen(health.binary, event.sessionID, text));
      }
    }

    if (observation.ask !== undefined) {
      const decision = decide(observation.ask, memoryOf(event.sessionID), envOf(health));
      remember(event.sessionID, decision.next);
    }

    yield* writeChanges(
      ctx.storage,
      ctx.location.project.id,
      event.sessionID,
      [...base, observation.change],
      observation.child,
    );

    const memory = memories.get(event.sessionID);
    if (memory !== undefined) {
      yield* syncEndOfWork(ctx, event.sessionID, needsEndOfWork(memory, health));
    }
  });

const observe = (
  ctx: Plugin.Context,
  event: ToolAfter,
  context: ObserveContext,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const base: ReadonlyArray<Change> =
      context.shuntChange === undefined ? [] : [context.shuntChange];
    const observation = readEvent(event, context.root);
    if (observation === undefined) {
      yield* writeChanges(ctx.storage, ctx.location.project.id, event.sessionID, base);
      yield* syncEndOfWorkFromMemory(ctx, event.sessionID);
      return;
    }
    if (context.health.kind !== "ready") {
      yield* writeChanges(ctx.storage, ctx.location.project.id, event.sessionID, base);
      return;
    }
    yield* applyObservation(ctx, event, observation, context.health, base);
  });

const observeFiltered = (ctx: Plugin.Context, event: ToolAfter): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (!isShuntAgent(event.agent)) return;
    const sessionScope = yield* sessionScopeOf(ctx, event.sessionID);
    const health = yield* probeHealth();
    const shuntEvent = yield* shuntAfter(ctx, event, health, sessionScope.directory);
    const shuntChange: Change | undefined =
      shuntEvent === undefined ? undefined : { kind: "shunt", ...shuntEvent };
    if (event.tool === "read" && (event.agent !== "spectre" || sessionScope.hasParent)) {
      yield* writeChanges(
        ctx.storage,
        ctx.location.project.id,
        event.sessionID,
        shuntChange === undefined ? [] : [shuntChange],
      );
      yield* syncEndOfWorkFromMemory(ctx, event.sessionID);
      return;
    }
    yield* observe(ctx, event, {
      root: sessionScope.directory,
      health,
      ...(shuntChange === undefined ? {} : { shuntChange }),
    });
  });

export const attachMeasure = (ctx: Plugin.Context): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    yield* ctx.tool.hook("execute.after", (event) =>
      observeFiltered(ctx, event).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("search measurement failed", { cause }).pipe(Effect.asVoid),
        ),
      ),
    );

    yield* Effect.logInfo("Registered search measurement", { trigger: "tool.execute.after" });
  });
