import type { Plugin } from "@opencode/plugin/effect";
import type { Model } from "@opencode/schema/model";
import type { Session } from "@opencode/schema/session";
import { Effect } from "effect";

/**
 * The directory the config is read from: the one the invoking session is in.
 *
 * A session carries its own location and `session.move` updates it, so a session
 * moved into a worktree reads that worktree's file. The plugin's location is not
 * a fallback: it is the location the plugin loaded with, so reading it after a
 * move would read the file of the directory the session left. When the session
 * cannot be read, the caller answers a problem instead.
 */
export const sessionDirectory = (
  ctx: Plugin.Context,
  sessionID: Session.ID,
): Effect.Effect<string | undefined> =>
  Effect.gen(function* () {
    const session = yield* ctx.session
      .get({ sessionID })
      .pipe(Effect.catch(() => Effect.succeed(undefined)));
    return session?.location.directory;
  });

/** The live catalogue, or an empty list and the reason it could not be read. */
export const hostCatalogue = (ctx: Plugin.Context) =>
  ctx.model.list().pipe(
    Effect.map((out) => ({ models: out.data, problem: undefined }) as const),
    Effect.catch(() =>
      Effect.succeed({
        models: [] as ReadonlyArray<Model.Info>,
        problem: `the model catalogue could not be read, so no model was checked`,
      } as const),
    ),
  );
