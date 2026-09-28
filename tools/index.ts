import type { Plugin } from "@opencode/plugin/effect";
import { Effect } from "effect";
import { comments } from "./definitions/comments";
import { routing } from "./definitions/routing";

export const update = (
  ctx: Pick<Plugin.Context, "tool" | "location"> & Plugin.Context,
) =>
  Effect.gen(function* () {
    const listed = comments(ctx.location.directory);
    const route = routing(ctx);

    // Not looped: `add` is generic, so a union of the two schemas instantiates to
    // neither and the call will not typecheck.
    yield* ctx.tool.transform((editor) => {
      editor.add(listed);
      editor.add(route);
    });

    yield* Effect.logInfo("Registered tools", {
      tools: [listed, route].map((tool) => `${tool.options?.namespace}_${tool.name}`),
    });
  });
