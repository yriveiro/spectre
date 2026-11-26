import type { Plugin } from "@opencode/plugin/effect";
import { Effect } from "effect";
import { attach, brain } from "./definitions/brain";
import { canvases } from "./definitions/canvas";
import { comments } from "./definitions/comments";
import { goal } from "./definitions/goal";
import { historyTool } from "./definitions/history";
import { attachSkillTelemetry, nocturnaTool } from "./definitions/nocturna";
import { papercuts } from "./definitions/papercuts";
import { pr } from "./definitions/pr";
import { prose } from "./definitions/prose";
import { attachRoutingGuard, routing } from "./definitions/routing";
import { load } from "./definitions/routing/load";
import { attachSearch, ripwire, search } from "./definitions/search";
import { skillsTool } from "./definitions/skills";
import { solidjs } from "./definitions/solidjs";
import { stack } from "./definitions/stack";
import { sessionReturn, worktrees } from "./definitions/worktrees";

export const NAMESPACE_DESCRIPTION =
  "Direct code search: spectre_search. Tools: worktrees (branch isolation, cleanup), pr (compose, open pull requests), stack (stacked PR merge order, blockers), routing (subagent model selection), brain (project memory: decisions, gotchas, lessons, constraints), history (file git blame, pickaxe rationale), goal (/goal loop contract, ledger), canvas (HTML, diagram, report, PR review artifacts), prose (ASD-STE100 grammar, dictionary check), comments (comment, lint/type suppression inventory), solidjs (Solid 1/2 detection, reactivity audit), ripwire (pre-landing quality-delta and affected-test check, session usage audit), skills (skill catalog search, list, preview), nocturna (rolling session audit digests, storage watermarks), papercuts (cross-project Spectre friction log, known workarounds).";

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
    const loop = goal(ctx);
    const solid = solidjs(ctx.location.directory);
    const found = search(ctx);
    const checked = ripwire(ctx);
    const catalog = skillsTool();
    const audits = nocturnaTool(ctx);
    const cuts = papercuts(ctx);

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
      editor.add(loop);
      editor.add(solid);
      editor.add(found);
      editor.add(checked);
      editor.add(catalog);
      editor.add(audits);
      editor.add(cuts);
      editor.namespace({
        name: "spectre",
        description: NAMESPACE_DESCRIPTION,
      });
    });

    yield* Effect.logInfo("Registered tools", {
      tools: [
        listed, said, route, trees, prs, opening, why, pages, memory, loop, solid, found, checked, catalog, audits, cuts,
      ].map((tool) => `${tool.options?.namespace}_${tool.name}`),
    });

    yield* sessionReturn(ctx);
    yield* attach(ctx);
    yield* attachSearch(ctx);
    yield* attachRoutingGuard(ctx);
    yield* attachSkillTelemetry(ctx);
  });
