import type { Plugin } from "@opencode/plugin/effect";
import { Effect } from "effect";
import { canvases } from "./definitions/canvas";
import { attach, brain } from "./definitions/brain";
import { comments } from "./definitions/comments";
import { historyTool } from "./definitions/history";
import { prose } from "./definitions/prose";
import { load } from "./definitions/routing/load";
import { pr } from "./definitions/pr";
import { routing } from "./definitions/routing";
import { stack } from "./definitions/stack";
import { sessionReturn, worktrees } from "./definitions/worktrees";

export const update = (ctx: Pick<Plugin.Context, "tool" | "location"> & Plugin.Context) =>
  Effect.gen(function* () {
    // The dictionary path is config, and a config mistake must be reported to
    // whoever asked for a word rather than stopping the session. The routing tool
    // reports the same problems, so the two do not disagree about what is wrong.
    const configured = yield* load(ctx.location.directory);
    const listed = comments(ctx.location.directory);
    const said = prose(ctx.location.directory, configured.tables.dictionary?.path);
    const route = routing(ctx);
    const trees = worktrees(ctx);
    const prs = stack(ctx.location.directory);
    const opening = pr(ctx);
    const why = historyTool(ctx.location.directory);
    const pages = canvases(ctx);
    const memory = brain(ctx);

    // Not looped: `add` is generic, so a union of the two schemas instantiates to
    // neither and the call will not typecheck.
    yield* ctx.tool.transform((editor) => {
      editor.add(listed);
      editor.add(said);
      editor.add(route);
      editor.add(trees);
      editor.add(prs);
      editor.add(opening);
      editor.add(why);
      editor.add(pages);
      editor.add(memory);
    });

    yield* Effect.logInfo("Registered tools", {
tools: [listed, said, route, trees, prs, opening, why, pages, memory].map(
        (tool) => `${tool.options?.namespace}_${tool.name}`,
      ),
    });

    yield* sessionReturn(ctx);
    yield* attach(ctx);
  });
