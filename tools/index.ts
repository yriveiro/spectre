import type { Plugin } from "@opencode/plugin/effect";
import { Effect } from "effect";
import { canvases } from "./definitions/canvas";
import { comments } from "./definitions/comments";
import { historyTool } from "./definitions/history";
import { routing } from "./definitions/routing";
import { stack } from "./definitions/stack";
import { sessionReturn, worktrees } from "./definitions/worktrees";

export const update = (ctx: Pick<Plugin.Context, "tool" | "location"> & Plugin.Context) =>
  Effect.gen(function* () {
    const listed = comments(ctx.location.directory);
    const route = routing(ctx);
    const trees = worktrees(ctx);
    const prs = stack(ctx.location.directory);
    const why = historyTool(ctx.location.directory);
    const pages = canvases(ctx);

    // Not looped: `add` is generic, so a union of the two schemas instantiates to
    // neither and the call will not typecheck.
    yield* ctx.tool.transform((editor) => {
      editor.add(listed);
      editor.add(route);
      editor.add(trees);
      editor.add(prs);
      editor.add(why);
      editor.add(pages);
    });

    yield* Effect.logInfo("Registered tools", {
      tools: [listed, route, trees, prs, why, pages].map(
        (tool) => `${tool.options?.namespace}_${tool.name}`,
      ),
    });

    yield* sessionReturn(ctx);
  });
