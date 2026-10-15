import type { Plugin } from "@opencode/plugin/effect";
import { Effect } from "effect";
import { anatomy } from "./definitions/anatomy";
import { effectAlign } from "./definitions/effect-align";
import { pr } from "./definitions/pr";
import { wt } from "./definitions/wt";

const definitions = [pr, anatomy, effectAlign, wt];

export const update = (ctx: Pick<Plugin.Context, "command" | "session">) =>
  Effect.gen(function* () {
    const commands = definitions.map((definition) => definition(ctx));

    yield* ctx.command.transform((editor) => {
      for (const command of commands) editor.add(command);
    });

    // The name off the built command, not off the factory. `one.name` was the factory's
    // function name, which read correctly for `/pr` and `/anatomy` because each happened to be
    // spelled like its command and wrong for `/effect-align` the moment the two diverged.
    yield* Effect.logInfo("Registered commands", {
      commands: commands.map((command) => `/${command.name}`),
    });
  });
