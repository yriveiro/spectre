import type { Plugin } from "@opencode/plugin/effect";
import { Effect, Option, Schema, type Scope } from "effect";
import { judge, type Route } from "./policy";
import { probe } from "./probe";
import { markRerouted, sessionSeen } from "./state";

const RipgrepInput = Schema.Struct({
  pattern: Schema.String,
  path: Schema.optional(Schema.String),
  include: Schema.optional(Schema.String),
  literal: Schema.optional(Schema.Boolean),
  caseSensitive: Schema.optional(Schema.Boolean),
  limit: Schema.optional(Schema.Number),
});

export type RipgrepInput = typeof RipgrepInput.Type;

const decodeAsk = Schema.decodeUnknownOption(RipgrepInput);

/** The ripgrep payload, decoded at the edge. Unknown keys are dropped. */
export const readAsk = (input: unknown): RipgrepInput | undefined =>
  Option.getOrUndefined(decodeAsk(input));

/**
 * Carry the verdict's route into the renamed call. The search tool re-derives
 * its route from the payload, which carries no `kind`, so without this every
 * reroute would run `--grep`: a task verdict sets `query`, a regex verdict
 * sets `kind: "regex"`, and a literal verdict leaves the input alone.
 */
export const rerouteInput = (input: RipgrepInput, route: Route): Record<string, unknown> => {
  switch (route.kind) {
    case "task":
      return { ...input, query: route.task };
    case "regex":
      return { ...input, kind: "regex" };
    case "literal":
      return { ...input };
  }
};

/**
 * The reroute: a code-shaped `ripgrep` call is answered by `spectre_search`
 * once per pattern per session.
 *
 * It matches `event.tool === "ripgrep"`, reads the ask with a schema, probes,
 * and judges. On a `route` verdict it asserts both the `grep` action (the call
 * the model made) and the `read` action (the tool that will run), records the
 * pattern in the session's seen set, marks the call id rerouted, carries the
 * route into the input, and renames `event.tool` to `"spectre_search"`.
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
        const ask = readAsk(event.input);
        if (ask === undefined) return;

        const health = yield* Effect.promise(() => probe()).pipe(
          Effect.catchDefect((defect) =>
            Effect.logWarning("search guard could not probe ripwire", { defect }).pipe(
              Effect.as(undefined),
            ),
          ),
        );
        if (health === undefined) return;

        const verdict = judge({ ask, seen: sessionSeen(event.sessionID), health });
        if (verdict.kind !== "route") return;

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

        sessionSeen(event.sessionID).add(ask.pattern);
        markRerouted(event.id);
        event.input = rerouteInput(ask, verdict.route);
        event.tool = "spectre_search";
      }),
    );

    yield* Effect.logInfo("Registered search guard", { trigger: "tool.execute.before" });
  });
