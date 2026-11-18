import type { Model, Plugin } from "@opencode/plugin/effect";
import type { Session } from "@opencode/schema/session";
import { Effect } from "effect";

const rootModelRef = (
  ctx: Plugin.Context,
  initial: {
    readonly id: Session.ID;
    readonly parentID?: Session.ID | undefined;
    readonly model?: { readonly providerID: string; readonly id: string } | undefined;
  },
): Effect.Effect<string | undefined> =>
  Effect.gen(function* () {
    let current = initial;
    const seen = new Set<string>([initial.id]);
    while (current.parentID !== undefined && !seen.has(current.parentID)) {
      const parentID = current.parentID;
      seen.add(parentID);
      const parent = yield* ctx.session
        .get({ sessionID: parentID })
        .pipe(Effect.catch(() => Effect.succeed(undefined)));
      if (parent === undefined) break;
      current = parent;
    }
    const chosen = current.model ?? initial.model;
    return chosen === undefined ? undefined : `${chosen.providerID}/${chosen.id}`;
  });

export const sessionState = (
  ctx: Plugin.Context,
  sessionID: Session.ID,
): Effect.Effect<{
  readonly directory: string | undefined;
  readonly modelRef: string | undefined;
}> =>
  Effect.gen(function* () {
    const session = yield* ctx.session
      .get({ sessionID })
      .pipe(Effect.catch(() => Effect.succeed(undefined)));
    if (session === undefined) return { directory: undefined, modelRef: undefined };
    const directory = session.location.directory;
    const fromMain = yield* rootModelRef(ctx, session);
    if (fromMain !== undefined) return { directory, modelRef: fromMain };
    if (typeof ctx.model?.default === "function") {
      const out = yield* ctx.model
        .default({ location: { directory } })
        .pipe(Effect.catch(() => Effect.succeed(undefined)));
      if (out?.data !== undefined)
        return { directory, modelRef: `${out.data.providerID}/${out.data.id}` };
    }
    return { directory, modelRef: undefined };
  });

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
