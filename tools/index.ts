import type { Plugin } from "@opencode/plugin/effect";
import { Effect } from "effect";
import { comments } from "./definitions/comments";

export const update = (ctx: Pick<Plugin.Context, "tool" | "location">) =>
  Effect.gen(function* () {
    const tool = comments(ctx.location.directory);

    yield* ctx.tool.transform((editor) => {
      editor.add(tool);
    });

    yield* Effect.logInfo("Registered tools", { tools: [`${tool.options?.namespace}_${tool.name}`] });
  });
