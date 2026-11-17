import { type Agent, type Plugin, Tool } from "@opencode/plugin/effect";
import type { Session } from "@opencode/schema/session";
import type { SessionMessage } from "@opencode/schema/session-message";
import { Effect, type Scope } from "effect";
import { isSpectre } from "./agents";
import { shape } from "./catalogue";
import { CONTRACT } from "./contract";
import { decide, type Ask, type Env, type Health, type ShellAsk, type TextAsk, type Verdict } from "./policy";
import { probe } from "./probe";
import { rootOf } from "./root";
import { contextAsk, grepAsk, mutateAsk, readAsk, shellAsk } from "./signals";
import { markRerouted, memoryOf, remember } from "./state";

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
      return mutateAsk(event.input, event.tool);
    default:
      return undefined;
  }
};

const healthOf = (): Effect.Effect<Health | undefined> =>
  Effect.promise(() => probe()).pipe(
    Effect.catchDefect((defect) =>
      Effect.logWarning("search guard could not probe ripwire", { defect }).pipe(Effect.as(undefined)),
    ),
  );

/**
 * The search and landing guard: a code-shaped `grep`/`ripgrep` or a bare `rg`/
 * `git grep` is answered by `spectre_search` in the same call, the first code
 * read without a lookup is refused once, and a landing is refused once until
 * the two measurements ran against the last mutation. `edit` and `write` only
 * record, because the landing gate reads that count.
 *
 * Only the probe is defect-protected. A plain permission decline is a defect at
 * `v2.3.0:packages/core/src/permission.ts:273-278`, so it must reach the host
 * and end the step. Catching it here would turn a "no" into a search.
 */
export const attachGuard = (ctx: Plugin.Context, read?: AskReader): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    yield* ctx.tool.hook("execute.before", (event) =>
      Effect.gen(function* () {
        if (!isSpectre(event.agent)) return;

        const root = yield* rootOf(ctx, event.sessionID);
        const ask = read === undefined ? askOf(root, event) : read(event);
        if (ask === undefined) return;

        const health = yield* healthOf();
        if (health === undefined) return;

        const decision = decide(ask, memoryOf(event.sessionID), envOf(health));
        const { verdict } = decision;

        if (verdict.kind === "refuse") {
          remember(event.sessionID, decision.next);
          yield* Effect.fail(new Tool.Error({ message: verdict.message }));
          return;
        }

        if (verdict.kind === "reroute") {
          const asks =
            ask.surface === "text"
              ? textAsks(ask.ask, root)
              : ask.surface === "shell"
                ? shellAsks(ask.parsed, ask.command, root)
                : undefined;
          if (asks !== undefined) yield* applyReroute(ctx, event, asks, verdict);
        }

        remember(event.sessionID, decision.next);
      }),
    );

    yield* Effect.logInfo("Registered search guard", { trigger: "tool.execute.before" });
  });

/**
 * The request catalogue. The rule the part carries is the one `decide` chose for
 * this request, so a session with no instrument is told that it is native. A
 * defect is logged, never thrown: the request is the model's next turn, and a
 * broken shape must not lose it.
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
        shape(event, verdict.kind === "prose" ? { ...CONTRACT, rule: verdict.text } : CONTRACT);
        remember(event.sessionID, decision.next);
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("search context failed", { cause }).pipe(Effect.asVoid),
        ),
      ),
    );

    yield* Effect.logInfo("Registered search context", { trigger: "session.context" });
  });
