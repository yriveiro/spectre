import type { Plugin } from "@opencode/plugin/effect";
import { Effect, type Scope } from "effect";
import { judge } from "./policy";
import { probe } from "./probe";
import { markRerouted, sessionSeen } from "./state";

type RipgrepInput = {
  readonly pattern: string;
  readonly path?: string;
  readonly include?: string;
  readonly literal?: boolean;
};

const readAsk = (input: unknown): RipgrepInput | undefined => {
  if (typeof input !== "object" || input === null) return undefined;
  const { pattern, path, include, literal } = input as {
    readonly pattern?: unknown;
    readonly path?: unknown;
    readonly include?: unknown;
    readonly literal?: unknown;
  };
  if (typeof pattern !== "string") return undefined;
  if (path !== undefined && typeof path !== "string") return undefined;
  if (include !== undefined && typeof include !== "string") return undefined;
  if (literal !== undefined && typeof literal !== "boolean") return undefined;
  return {
    pattern,
    ...(path === undefined ? {} : { path }),
    ...(include === undefined ? {} : { include }),
    ...(literal === undefined ? {} : { literal }),
  };
};

/**
 * The reroute: a code-shaped `ripgrep` call is answered by `spectre_search`
 * once per pattern per session.
 *
 * It matches `event.tool === "ripgrep"`, reads the ask with a guard, probes,
 * and judges. On a `route` verdict it asserts the permission with
 * `action: "grep"` — the permission action stays `grep` while the model sees
 * `ripgrep` — records the pattern in the session's seen set, marks the call
 * id rerouted, and renames `event.tool` to `"spectre_search"`.
 *
 * Only defects are caught, following
 * `tools/definitions/worktrees/return/index.ts:51-73`: the permission
 * rejection is a typed `Tool.Error` and is the point of the channel, so it
 * must reach the caller. A measurement that blew up must not become a
 * rejected tool call the model cannot act on.
 */
export const attachGuard = (ctx: Plugin.Context): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    yield* ctx.tool.hook("execute.before", (event) =>
      Effect.gen(function* () {
        if (event.tool !== "ripgrep") return;
        const ask = readAsk(event.input);
        if (ask === undefined) return;

        const health = yield* Effect.promise(() => probe());
        const verdict = judge(
          {
            pattern: ask.pattern,
            ...(ask.path === undefined ? {} : { path: ask.path }),
            ...(ask.include === undefined ? {} : { include: ask.include }),
            ...(ask.literal === undefined ? {} : { literal: ask.literal }),
          },
          sessionSeen(event.sessionID),
          health,
        );
        if (verdict.kind !== "route") return;

        yield* ctx.permission.assert({
          sessionID: event.sessionID,
          agent: event.agent,
          action: "grep",
          resources: [ask.pattern],
          metadata: {
            ...(ask.path === undefined ? {} : { path: ask.path }),
            ...(ask.include === undefined ? {} : { include: ask.include }),
          },
          source: { type: "tool", messageID: event.messageID, id: event.id },
        });

        sessionSeen(event.sessionID).add(ask.pattern);
        markRerouted(event.id);
        event.tool = "spectre_search";
      }).pipe(
        Effect.catchDefect((defect) =>
          Effect.logWarning("search guard could not judge the ripgrep call", {
            sessionID: event.sessionID,
            defect,
          }).pipe(Effect.asVoid),
        ),
      ),
    );

    yield* Effect.logInfo("Registered search guard", { trigger: "tool.execute.before" });
  });
