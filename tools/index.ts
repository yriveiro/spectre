import type { Plugin } from "@opencode/plugin/effect";
import { Effect } from "effect";
import { attach, brain } from "./definitions/brain";
import { canvases } from "./definitions/canvas";
import { comments } from "./definitions/comments";
import { historyTool } from "./definitions/history";
import { pr } from "./definitions/pr";
import { prose } from "./definitions/prose";
import { routing } from "./definitions/routing";
import { load } from "./definitions/routing/load";
import { attachSearch, search } from "./definitions/search";
import { solidjs } from "./definitions/solidjs";
import { stack } from "./definitions/stack";
import { sessionReturn, worktrees } from "./definitions/worktrees";

export const update = (ctx: Plugin.Context) =>
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
    const solid = solidjs(ctx.location.directory);
    const found = search(ctx);

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
      editor.add(solid);
      editor.add(found);
      editor.namespace({
        name: "spectre",
        description: "Code search is spectre_search; the rest are Spectre's own tools.",
      });
    });

    yield* Effect.logInfo("Registered tools", {
      tools: [listed, said, route, trees, prs, opening, why, pages, memory, solid, found].map(
        (tool) => `${tool.options?.namespace}_${tool.name}`,
      ),
    });

    yield* sessionReturn(ctx);
    yield* attach(ctx);
    yield* attachSearch(ctx);
  });
