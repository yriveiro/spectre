import type { Plugin } from "@opencode/plugin/effect";
import { Effect } from "effect";
import { anatomy } from "./definitions/anatomy";
import { guardFigure } from "./definitions/anatomy/guard";
import { attach, brain } from "./definitions/brain";
import { canvases } from "./definitions/canvas";
import { comments } from "./definitions/comments";
import { historyTool } from "./definitions/history";
import { pr } from "./definitions/pr";
import { prose } from "./definitions/prose";
import { routing } from "./definitions/routing";
import { load } from "./definitions/routing/load";
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
    const figures = anatomy(ctx.location.directory);
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
      editor.add(figures);
    });

    yield* Effect.logInfo("Registered tools", {
      tools: [listed, said, route, trees, prs, opening, why, pages, memory, figures].map(
        (tool) => `${tool.options?.namespace}_${tool.name}`,
      ),
    });

    // A figure is held back from the reader until its geometry has been proved.
    // `tool.execute.before` is the only hook that can reject a call, so it is
    // the only place this can be enforced.
    yield* ctx.tool.hook("execute.before", guardFigure());

    yield* sessionReturn(ctx);
    yield* attach(ctx);
  });
