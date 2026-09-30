import type { Plugin } from "@opencode/plugin/effect";
import { Tool } from "@opencode/schema/tool";
import type { Session } from "@opencode/schema/session";
import { Effect } from "effect";
import { home, say, type Standing } from "./home";
import { ask } from "./standing";

/**
 * The move, or the reason there was not one. `undefined` is the silent path, which is
 * the `string | undefined` a caller switches on.
 */
const rescue = (ctx: Plugin.Context, asked: Standing, sessionID: Session.ID) =>
  Effect.gen(function* () {
    const verdict = home(asked);
    if (verdict.kind === "left-alone") return undefined;

    if (verdict.kind !== "held" && asked.main.kind === "found") {
      // `SessionMove` validates the destination and, when the session's own directory
      // is gone, publishes `SessionEvent.Moved` directly rather than through the inbox
      // — `packages/core/src/session/move.ts` at v2.0.20. A failure here is not fatal:
      // the caller still tells the session what happened.
      yield* Effect.result(ctx.session.move({ sessionID, directory: asked.main.directory }));
    }
    return say(asked);
  });

/**
 * The session that lost its worktree returns itself, at the two moments it can be hurt.
 */
export const update = (ctx: Plugin.Context) =>
  Effect.gen(function* () {
    yield* ctx.session.hook("prompt", (event) =>
      Effect.gen(function* () {
        const asked = yield* ask(ctx, event.sessionID);
        if (asked === undefined) return;
        const line = yield* rescue(ctx, asked, event.sessionID);
        if (line !== undefined) event.prompt.text = `${line}\n\n${event.prompt.text}`;
      }).pipe(
        // Session hooks are declared `NoFailures` (`packages/core/src/plugin/hooks.ts`
        // at v2.0.20), so this callback has to be total: a prompt must not fail
        // because a rescue could not be measured.
        Effect.catchCause((cause) =>
          Effect.logWarning("session return could not be measured", { sessionID: event.sessionID, cause }).pipe(
            Effect.asVoid,
          ),
        ),
      ),
    );

    yield* ctx.tool.hook("execute.before", (event) =>
      Effect.gen(function* () {
        const asked = yield* ask(ctx, event.sessionID);
        if (asked === undefined) return;
        const line = yield* rescue(ctx, asked, event.sessionID);
        if (line === undefined) return;
        yield* Effect.fail(
          new Tool.Error({
            message: `${line}\n\nThat call did not run, and neither will the next one until it does: this session has been moved to the project's main worktree. Re-issue the original intent.`,
          }),
        );
      }).pipe(
        // `catchDefect`, not `catchCause`: the rejection above is a typed
        // `Tool.Error` and is the whole point of this channel, so it has to reach the
        // caller. Only a defect — a measurement that blew up — is swallowed, because a
        // defect must not become a rejected tool call the model cannot act on.
        Effect.catchDefect((defect) =>
          Effect.logWarning("session return could not be measured", { sessionID: event.sessionID, defect }).pipe(
            Effect.asVoid,
          ),
        ),
      ),
    );

    yield* Effect.logInfo("Registered session return", {
      triggers: ["session.prompt", "tool.execute.before"],
    });
  });
