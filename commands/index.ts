import type { Plugin } from "@opencode/plugin/effect";
import { Effect } from "effect";
import { pr } from "./definitions/pr";

const definitions = [pr];

export const update = (ctx: Pick<Plugin.Context, "command" | "session">) =>
  Effect.gen(function* () {
    yield* ctx.command.transform((editor) => {
      for (const definition of definitions) editor.add(definition(ctx));
    });

    yield* Effect.logInfo("Registered commands", {
      commands: definitions.map((one) => `/${one.name}`),
    });
  });