import { Plugin } from "@opencode/plugin/effect";
import { Cause, Effect, Exit, Scope } from "effect";
import type { Block } from "./block";

export interface Bundle {
  readonly id: string;
  readonly blocks: readonly Block[];
}

const ownedKeys = ["tools", "skills", "commands", "agents"] as const;

const validate = (bundle: Bundle) => {
  const blockIds = new Set<string>();
  const owners = new Map<string, string>();

  for (const block of bundle.blocks) {
    if (!block.id) throw new Error("a block needs an id");
    if (blockIds.has(block.id)) throw new Error(`duplicate block id: ${block.id}`);
    blockIds.add(block.id);

    for (const key of ownedKeys) {
      const seen = new Set<string>();
      for (const id of block.surfaces[key]) {
        if (!id) throw new Error(`${block.id} declares an empty ${key} entry`);
        if (seen.has(id)) throw new Error(`${block.id} declares ${key} ${id} twice`);
        seen.add(id);

        const owner = owners.get(`${key}:${id}`);
        if (owner) throw new Error(`${key} ${id} is declared by ${owner} and ${block.id}`);
        owners.set(`${key}:${id}`, block.id);
      }
    }
  }
};

/**
 * A bundle is OpenCode's install unit: one package, one plugin id, several
 * blocks. Each block registers through the real `Plugin.Context` in its own
 * child scope, so a block that fails halfway is rolled back without touching
 * its siblings.
 */
export const defineBundle = (bundle: Bundle) => {
  validate(bundle);

  return {
    id: bundle.id,
    blocks: bundle.blocks,
    plugin: Plugin.define({
      id: bundle.id,
      effect: Effect.fn("spectre.bundle")(function* (ctx: Plugin.Context) {
        const activation = yield* Scope.Scope;

        for (const block of bundle.blocks) {
          const scope = yield* Scope.fork(activation);
          const registered = yield* Effect.exit(
            block.effect(ctx).pipe(Effect.provideService(Scope.Scope, scope)),
          );

          if (Exit.isFailure(registered)) {
            if (Cause.hasInterrupts(registered.cause)) return yield* Effect.interrupt;
            if (Cause.hasDies(registered.cause)) return yield* Effect.die(registered.cause);

            yield* Scope.close(scope, registered);
            yield* Effect.logError("block registration failed", {
              block: block.id,
              cause: Cause.pretty(registered.cause),
            });
            continue;
          }
        }

        yield* Effect.logInfo("spectre bundle loaded", {
          id: bundle.id,
          blocks: bundle.blocks.length,
        });
      }),
    }),
  };
};
