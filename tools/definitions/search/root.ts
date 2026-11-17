import type { Plugin } from "@opencode/plugin/effect";
import type { Session } from "@opencode/schema/session";
import { Effect } from "effect";

export const rootOf = (ctx: Plugin.Context, sessionID: Session.ID): Effect.Effect<string> => {
  const fallback = ctx.location.directory;
  const sessionDomain = (ctx as { readonly session?: Plugin.Context["session"] }).session;
  if (sessionDomain === undefined || typeof sessionDomain.get !== "function") {
    return Effect.succeed(fallback);
  }
  return sessionDomain.get({ sessionID }).pipe(
    Effect.map((info) => {
      const directory = info?.location?.directory;
      return typeof directory === "string" && directory !== "" ? directory : fallback;
    }),
    Effect.catchCause(() => Effect.succeed(fallback)),
  );
};
