import type { Plugin, Skill } from "@opencode/plugin/effect";
import type { Agent } from "@opencode/schema/agent";
import type { Session } from "@opencode/schema/session";
import type { SessionMessage } from "@opencode/schema/session-message";
import type { Tool } from "@opencode/schema/tool";
import { Effect, type Scope } from "effect";
import { shape } from "./catalogue";
import { CONTRACT } from "./contract";
import { decide, type Env, type Health, MAP, type TextAsk, type Verdict } from "./policy";
import { probe } from "./probe";
import { contextAsk, grepAsk } from "./signals";
import { markRerouted, memoryOf, remember } from "./state";

/**
 * The appliers. A verdict is a decision; this file is what it costs on the host:
 * the two permission asserts and the tool rename for a reroute, the prose rule
 * and the catalogue for a request, the skill attachment for the first prompt.
 * `decide` never touches the host.
 */

/** The `session.prompt` event, as far as the applier reads it. */
interface PromptBefore {
  readonly sessionID: Session.ID;
  prompt: { skills?: Array<{ readonly id: Skill.ID }> };
}

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

/**
 * The prompt row runs above the health gate, so no instrument is probed for it:
 * `skill` and `parentID` are its only facts, and `decide` never reads the third.
 */
const promptEnv = (skill: boolean, parentID: boolean): Env => ({
  health: { kind: "absent", why: "the prompt row reads no instrument" },
  skill,
  parentID,
});

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
 * The request catalogue. The rule the part carries is the one `decide` chose for
 * this request, so a session with no instrument is told that it is native. A
 * defect is logged, never thrown: the request is the model's next turn, and a
 * broken shape must not lose it.
 */
export const attachCatalogue = (ctx: Plugin.Context): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    yield* ctx.session.hook("context", (event) =>
      Effect.gen(function* () {
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

/**
 * Whether the host holds the map. The attachment is resolved by id at prompt
 * admission, and an id the host does not know fails the prompt, so a list that
 * cannot answer leaves the prompt alone.
 */
const holdsSkill = (ctx: Plugin.Context, skill: Skill.ID): Effect.Effect<boolean> =>
  ctx.skill.list().pipe(
    Effect.map((listing) => listing.data.some((one) => one.id === skill)),
    Effect.catchCause((cause) =>
      Effect.logWarning("search discovery could not list the skills", { cause }).pipe(Effect.as(false)),
    ),
  );

/** A child session is a new context, so it pays its own attachment and the memory records that it did. */
const childOf = (ctx: Plugin.Context, sessionID: Session.ID): Effect.Effect<boolean> =>
  ctx.session.get({ sessionID }).pipe(
    Effect.map((info) => info.parentID !== undefined),
    Effect.catchCause(() => Effect.succeed(false)),
  );

/**
 * The first user prompt of every session, child included, carries the compact
 * `ripwire-first` map: the host resolves the body once and persists it in that
 * message. `decide` owns the once-per-session rule, so a second prompt attaches
 * nothing. A session already holding the skill was attached by the user, and the
 * body is not attached twice.
 */
const discover = (ctx: Plugin.Context, event: PromptBefore): Effect.Effect<void> =>
  Effect.gen(function* () {
    const memory = memoryOf(event.sessionID);
    if (memory.attached) return;

    const skill = yield* holdsSkill(ctx, MAP);
    const parentID = yield* childOf(ctx, event.sessionID);
    const decision = decide({ surface: "prompt" }, memory, promptEnv(skill, parentID));
    const { verdict } = decision;

    if (verdict.kind === "attach") {
      const held = event.prompt.skills ?? [];
      const already = held.some((one) => one.id === verdict.skill);
      if (!already) event.prompt.skills = [...held, { id: verdict.skill }];
    }

    remember(event.sessionID, decision.next);
  });

/** The prompt surface. A defect is logged, never thrown: discovery must not lose the prompt. */
export const attachDiscovery = (ctx: Plugin.Context): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    yield* ctx.session.hook("prompt", (event) =>
      discover(ctx, event).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("search discovery failed", { cause }).pipe(Effect.asVoid),
        ),
      ),
    );

    yield* Effect.logInfo("Registered search discovery", { trigger: "session.prompt" });
  });
