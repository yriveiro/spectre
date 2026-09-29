import type { Plugin } from "@opencode/plugin/effect";
import { Effect } from "effect";
import { comments } from "./definitions/comments";
import { historyTool } from "./definitions/history";
import { routing } from "./definitions/routing";
import { stack } from "./definitions/stack";
import { worktrees } from "./definitions/worktrees";

export const update = (ctx: Pick<Plugin.Context, "tool" | "location"> & Plugin.Context) =>
  Effect.gen(function* () {
    const listed = comments(ctx.location.directory);
    const route = routing(ctx);
    const trees = worktrees(ctx);
    const prs = stack(ctx.location.directory);
    const why = historyTool(ctx.location.directory);

    // Not looped: `add` is generic, so a union of the two schemas instantiates to
    // neither and the call will not typecheck.
    yield* ctx.tool.transform((editor) => {
      editor.add(listed);
      editor.add(route);
      editor.add(trees);
      editor.add(prs);
      editor.add(why);
    });

    yield* Effect.logInfo("Registered tools", {
      tools: [listed, route, trees, prs, why].map(
        (tool) => `${tool.options?.namespace}_${tool.name}`,
      ),
    });
  });
