import type { Plugin } from "@opencode/plugin/effect";
import { Effect } from "effect";
import { pr } from "./definitions/pr";

const definitions = [pr];

/**
 * The names `ctx.command.transform` publishes, logged the way `tools/index.ts` logs its
 * own. A command that registers but never resolves in the palette is the failure this line
 * exists to make visible, and the palette is where a reader looks for `/pr`.
 */
export const update = (ctx: Pick<Plugin.Context, "command" | "session">) =>
  Effect.gen(function* () {
    yield* ctx.command.transform((editor) => {
      for (const definition of definitions) editor.add(definition(ctx));
    });

    yield* Effect.logInfo("Registered commands", {
      commands: definitions.map((one) => `/${one.name}`),
    });
  });