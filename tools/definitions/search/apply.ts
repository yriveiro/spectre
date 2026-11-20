import { type Agent, type Plugin, Tool } from "@opencode/plugin/effect";
import { InstructionEntry } from "@opencode/schema/instruction-entry";
import type { Session } from "@opencode/schema/session";
import type { SessionMessage } from "@opencode/schema/session-message";
import { Effect, type Scope } from "effect";
import { isSpectre } from "./agents";
import { shape } from "./catalogue";
import { CONTRACT, END_OF_WORK } from "./contract";
import {
  type Ask,
  contextRule,
  type Decision,
  decide,
  type Env,
  type Health,
  type Memory,
  type ShellAsk,
  type TextAsk,
  type Verdict,
} from "./policy";
import { probe } from "./probe";
import { sessionScopeOf } from "./root";
import { contextAsk, grepAsk, mutateAsk, readAsk, shellAsk } from "./signals";
import { markRerouted, memories, memoryOf, remember } from "./state";

/**
 * The appliers. A verdict is a decision; this file is what it costs on the host:
 * the two permission asserts and the tool rename for a reroute, and the prose rule
 * and catalogue for a request. `decide` never touches the host.
 */

/** The `execute.before` event, as far as the applier reads it. */
export interface ToolBefore {
  tool: string;
  readonly sessionID: Session.ID;
  readonly agent: Agent.ID;
  readonly messageID: SessionMessage.ID;
  readonly id: Tool.CallID;
  input: unknown;
}

export const envOf = (health: Health): Env => ({ health });

/* The text payload's two asserts, and the shell payload's: the action the model
 * asked for, then the read the renamed tool will run. */
interface RerouteAsks {
  readonly action: "grep" | "shell";
  readonly resources: ReadonlyArray<string>;
  readonly read: string;
  readonly metadata: Record<string, string>;
}

const textAsks = (ask: TextAsk, root: string): RerouteAsks => ({
  action: "grep",
  resources: [ask.pattern],
  read: ask.path ?? root,
  metadata: {
    ...(ask.path === undefined ? {} : { path: ask.path }),
    ...(ask.include === undefined ? {} : { include: ask.include }),
  },
});

const shellAsks = (parsed: ShellAsk, command: string, root: string): RerouteAsks | undefined => {
  if (parsed.kind !== "search") return undefined;
  return {
    action: "shell",
    resources: [command],
    read: parsed.path ?? root,
    metadata: parsed.path === undefined ? {} : { path: parsed.path },
  };
};

const assertSearch = (
  ctx: Plugin.Context,
  event: ToolBefore,
  asks: RerouteAsks,
): Effect.Effect<void, Tool.Error> =>
  Effect.gen(function* () {
    yield* ctx.permission.assert({
      sessionID: event.sessionID,
      agent: event.agent,
      action: asks.action,
      resources: [...asks.resources],
      save: ["*"],
      metadata: asks.metadata,
      source: { type: "tool", messageID: event.messageID, id: event.id },
    });

    yield* ctx.permission.assert({
      sessionID: event.sessionID,
      agent: event.agent,
      action: "read",
      resources: [asks.read],
      save: ["*"],
      metadata: asks.metadata,
      source: { type: "tool", messageID: event.messageID, id: event.id },
    });
  });

/**
 * The reroute: assert both the action the model asked for and the action the
 * renamed tool will take, record the call id, then rename in place.
 */
const applyReroute = (
  ctx: Plugin.Context,
  event: ToolBefore,
  asks: RerouteAsks,
  verdict: Extract<Verdict, { kind: "reroute" }>,
): Effect.Effect<void, Tool.Error> =>
  Effect.gen(function* () {
    yield* assertSearch(ctx, event, asks);
    markRerouted(event.id, verdict.origin);
    event.input = verdict.input;
    event.tool = "spectre_search";
  });

/** One reader per call: the shipped `askOf`, or a test that proves the gate depends on it. */
export type AskReader = (event: ToolBefore) => Ask | undefined;

/** The surface this call names, or `undefined` when the call is not one the rule reads. */
const askOf = (root: string, event: ToolBefore): Ask | undefined => {
  const text = grepAsk(event.input, event.tool);
  if (text !== undefined) return text;
  switch (event.tool) {
    case "shell":
      return shellAsk(event.input);
    case "read":
      return readAsk(event.input, root);
    case "edit":
    case "write":
      return mutateAsk(event.input, event.tool, root);
    default:
      return undefined;
  }
};

const healthOf = (): Effect.Effect<Health | undefined> =>
  Effect.promise(() => probe()).pipe(
    Effect.catchDefect((defect) =>
      Effect.logWarning("search guard could not probe ripwire", { defect }).pipe(
        Effect.as(undefined),
      ),
    ),
  );

const END_OF_WORK_KEY = InstructionEntry.Key.make("spectre.end-of-work");
const MAX_SYNCED = 256;

export const endOfWorkSynced: Set<Session.ID> = new Set();

export const needsEndOfWork = (memory: Memory, health: Health): boolean => {
  if (health.kind !== "ready") return false;
  const { verdict } = decide({ surface: "context", tools: [] }, memory, envOf(health));
  return verdict.kind === "prose" && verdict.key === "end-of-work";
};

export const syncEndOfWork = (
  ctx: Plugin.Context,
  sessionID: Session.ID,
  active: boolean,
): Effect.Effect<void> => {
  const entry = ctx.session?.instructions?.entry;
  if (entry === undefined) return Effect.void;
  const present = endOfWorkSynced.has(sessionID);
  if (active === present) return Effect.void;
  if (active) {
    return entry.put({ sessionID, key: END_OF_WORK_KEY, value: END_OF_WORK }).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          if (endOfWorkSynced.size >= MAX_SYNCED) {
            const oldest = endOfWorkSynced.values().next();
            if (!oldest.done) endOfWorkSynced.delete(oldest.value);
          }
          endOfWorkSynced.add(sessionID);
        }),
      ),
      Effect.catchCause((cause) =>
        Effect.logWarning("search end-of-work put failed", { sessionID, cause }).pipe(
          Effect.asVoid,
        ),
      ),
    );
  }
  return entry.remove({ sessionID, key: END_OF_WORK_KEY }).pipe(
    Effect.tap(() =>
      Effect.sync(() => {
        endOfWorkSynced.delete(sessionID);
      }),
    ),
    Effect.catchCause((cause) =>
      Effect.logWarning("search end-of-work remove failed", { sessionID, cause }).pipe(
        Effect.asVoid,
      ),
    ),
  );
};

export const syncEndOfWorkFromMemory = (
  ctx: Plugin.Context,
  sessionID: Session.ID,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const memory = memories.get(sessionID);
    if (memory === undefined) {
      if (endOfWorkSynced.has(sessionID)) yield* syncEndOfWork(ctx, sessionID, false);
      return;
    }
    if (!endOfWorkSynced.has(sessionID) && memory.editedCode.size === 0) return;
    const health = yield* healthOf();
    if (health === undefined) return;
    yield* syncEndOfWork(ctx, sessionID, needsEndOfWork(memory, health));
  });

const rerouteAsksOf = (ask: Ask, root: string): RerouteAsks | undefined => {
  if (ask.surface === "text") return textAsks(ask.ask, root);
  if (ask.surface === "shell") return shellAsks(ask.parsed, ask.command, root);
  return undefined;
};

interface GuardStep {
  readonly ctx: Plugin.Context;
  readonly event: ToolBefore;
  readonly root: string;
  readonly childSubagent: boolean;
  readonly ask: Ask;
  readonly prev: Memory;
  readonly decision: Decision;
  readonly health: Health;
}

const applyRefusal = (
  step: GuardStep,
  verdict: Extract<Verdict, { readonly kind: "refuse" }>,
): Effect.Effect<void, Tool.Error> =>
  Effect.gen(function* () {
    if (verdict.gate === "read" && step.childSubagent) {
      const bypassed = { ...step.prev, reads: step.prev.reads + 1 };
      remember(step.event.sessionID, bypassed);
      yield* syncEndOfWork(step.ctx, step.event.sessionID, needsEndOfWork(bypassed, step.health));
      return;
    }
    remember(step.event.sessionID, step.decision.next);
    yield* Effect.fail(new Tool.Error({ message: verdict.message }));
  });

const applyVerdict = (step: GuardStep): Effect.Effect<void, Tool.Error> =>
  Effect.gen(function* () {
    const { verdict } = step.decision;
    if (verdict.kind === "refuse") {
      yield* applyRefusal(step, verdict);
      return;
    }
    if (verdict.kind === "reroute") {
      const asks = rerouteAsksOf(step.ask, step.root);
      if (asks !== undefined) yield* applyReroute(step.ctx, step.event, asks, verdict);
    }
    remember(step.event.sessionID, step.decision.next);
    yield* syncEndOfWork(
      step.ctx,
      step.event.sessionID,
      needsEndOfWork(step.decision.next, step.health),
    );
  });

const resolveAsk = (root: string, event: ToolBefore, read?: AskReader): Ask | undefined =>
  read === undefined ? askOf(root, event) : read(event);

const guardBefore = (
  ctx: Plugin.Context,
  event: ToolBefore,
  read?: AskReader,
): Effect.Effect<void, Tool.Error> =>
  Effect.gen(function* () {
    if (!isSpectre(event.agent)) return;
    const sessionScope = yield* sessionScopeOf(ctx, event.sessionID);
    const ask = resolveAsk(sessionScope.directory, event, read);
    if (ask === undefined) return;
    const health = yield* healthOf();
    if (health === undefined) return;
    const prev = memoryOf(event.sessionID);
    const decision = decide(ask, prev, envOf(health));
    yield* applyVerdict({
      ctx,
      event,
      root: sessionScope.directory,
      childSubagent: event.agent !== "spectre" || sessionScope.hasParent,
      ask,
      prev,
      decision,
      health,
    });
  });

export const attachGuard = (
  ctx: Plugin.Context,
  read?: AskReader,
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    yield* ctx.tool.hook("execute.before", (event) => guardBefore(ctx, event, read));
    yield* Effect.logInfo("Registered search guard", { trigger: "tool.execute.before" });
  });

/**
 * The request catalogue. The rule the part carries is `contextRule(health)`,
 * while unmeasured code-edit reminders sync through durable instruction entries
 * so `event.system` stays identical across edits. A defect is logged, never
 * thrown: the request is the model's next turn, and a broken shape must not
 * lose it.
 */
export const attachCatalogue = (ctx: Plugin.Context): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    yield* ctx.session.hook("context", (event) =>
      Effect.gen(function* () {
        if (!isSpectre(event.agent)) return;

        const ask = contextAsk(event);
        if (ask === undefined) return shape(event);

        const health = yield* Effect.promise(() => probe()).pipe(
          Effect.catchCause(() => Effect.succeed(undefined)),
        );
        if (health === undefined) return shape(event);

        const decision = decide(ask, memoryOf(event.sessionID), envOf(health));
        const { verdict } = decision;
        shape(event, { ...CONTRACT, rule: contextRule(health) });
        remember(event.sessionID, decision.next);
        yield* syncEndOfWork(
          ctx,
          event.sessionID,
          health.kind === "ready" && verdict.kind === "prose" && verdict.key === "end-of-work",
        );
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("search context failed", { cause }).pipe(Effect.asVoid),
        ),
      ),
    );

    yield* Effect.logInfo("Registered search context", { trigger: "session.context" });
  });
