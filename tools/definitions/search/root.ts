import type { Plugin } from "@opencode/plugin/effect";
import type { Session } from "@opencode/schema/session";
import { Effect } from "effect";

export interface SessionScope {
  readonly directory: string;
  readonly hasParent: boolean;
}

export const sessionScopeOf = (
  ctx: Plugin.Context,
  sessionID: Session.ID,
): Effect.Effect<SessionScope> => {
  const fallback: SessionScope = { directory: ctx.location.directory, hasParent: false };
  const sessionDomain = (ctx as { readonly session?: Plugin.Context["session"] }).session;
  if (sessionDomain === undefined || typeof sessionDomain.get !== "function") {
    return Effect.succeed(fallback);
  }
  return sessionDomain.get({ sessionID }).pipe(
    Effect.map((info) => {
      const directory = info?.location?.directory;
      return {
        directory:
          typeof directory === "string" && directory !== "" ? directory : fallback.directory,
        hasParent: info?.parentID !== undefined,
      };
    }),
    Effect.catchCause(() => Effect.succeed(fallback)),
  );
};

export const rootOf = (ctx: Plugin.Context, sessionID: Session.ID): Effect.Effect<string> =>
  sessionScopeOf(ctx, sessionID).pipe(Effect.map((scope) => scope.directory));
