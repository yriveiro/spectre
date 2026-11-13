import type { Plugin } from "@opencode/plugin/effect";
import type { Agent } from "@opencode/schema/agent";
import type { Session } from "@opencode/schema/session";
import type { SessionMessage } from "@opencode/schema/session-message";
import type { Tool } from "@opencode/schema/tool";
import { Effect, type Scope } from "effect";
import { shape } from "./catalogue";
import { decide, type Env, type Health, type TextAsk, type Verdict } from "./policy";
import { probe } from "./probe";
import { grepAsk } from "./signals";
import { markRerouted, memoryOf, remember } from "./state";

/**
 * The appliers. A verdict is a decision; this file is what it costs on the host:
 * the two permission asserts and the tool rename for a reroute, the prose rule
 * and the catalogue for a request. `decide` never touches the host.
 */

/** The `execute.before` event, as far as the applier reads it. */
interface ToolBefore {
  tool: string;
  readonly sessionID: Session.ID;
  readonly agent: Agent.ID;
  readonly messageID: SessionMessage.ID;
  readonly id: Tool.CallID;
  input: unknown;
}

/** The text surface reads `health` alone; `skill` and `parentID` are the prompt's facts. */
const envOf = (health: Health): Env => ({ health, skill: true, parentID: false });

const assertSearch = (
  ctx: Plugin.Context,
  event: ToolBefore,
  ask: TextAsk,
): Effect.Effect<void, Tool.Error> =>
  Effect.gen(function* () {
    yield* ctx.permission.assert({
      sessionID: event.sessionID,
      agent: event.agent,
      action: "grep",
      resources: [ask.pattern],
      save: ["*"],
      metadata: {
        ...(ask.path === undefined ? {} : { path: ask.path }),
        ...(ask.include === undefined ? {} : { include: ask.include }),
      },
      source: { type: "tool", messageID: event.messageID, id: event.id },
    });

    yield* ctx.permission.assert({
      sessionID: event.sessionID,
      agent: event.agent,
      action: "read",
      resources: [ask.path ?? ctx.location.directory],
      save: ["*"],
      metadata: {
        ...(ask.path === undefined ? {} : { path: ask.path }),
        ...(ask.include === undefined ? {} : { include: ask.include }),
      },
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
  ask: TextAsk,
  verdict: Extract<Verdict, { kind: "reroute" }>,
): Effect.Effect<void, Tool.Error> =>
  Effect.gen(function* () {
    yield* assertSearch(ctx, event, ask);
    markRerouted(event.id, verdict.origin);
    event.input = verdict.input;
    event.tool = "spectre_search";
  });

/**
 * The code-search guard: a code-shaped `ripgrep` call is answered by
 * `spectre_search` once per pattern per session.
 *
 * Only the probe is defect-protected. A plain permission decline is a defect at
 * `v2.2.7:packages/core/src/permission.ts:273-278`, so it must reach the host
 * and end the step. Catching it here would turn a "no" into a search.
 */
export const attachGuard = (ctx: Plugin.Context): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    yield* ctx.tool.hook("execute.before", (event) =>
      Effect.gen(function* () {
        if (event.tool !== "ripgrep") return;
        const ask = grepAsk(event.input, event.tool);
        if (ask === undefined) return;

        const health = yield* Effect.promise(() => probe()).pipe(
          Effect.catchDefect((defect) =>
            Effect.logWarning("search guard could not probe ripwire", { defect }).pipe(
              Effect.as(undefined),
            ),
          ),
        );
        if (health === undefined) return;

        const decision = decide(ask, memoryOf(event.sessionID), envOf(health));
        if (decision.verdict.kind === "reroute") {
          yield* applyReroute(ctx, event, ask.ask, decision.verdict);
        }
        remember(event.sessionID, decision.next);
      }),
    );

    yield* Effect.logInfo("Registered search guard", { trigger: "tool.execute.before" });
  });

/**
 * The request catalogue. A defect is logged, never thrown: the request is the
 * model's next turn, and a broken shape must not lose it.
 */
export const attachCatalogue = (ctx: Plugin.Context): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    yield* ctx.session.hook("context", (event) =>
      Effect.sync(() => shape(event)).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("search context failed", { cause }).pipe(Effect.asVoid),
        ),
      ),
    );

    yield* Effect.logInfo("Registered search context", { trigger: "session.context" });
  });
