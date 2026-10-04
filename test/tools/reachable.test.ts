import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { load } from "../../skills/definitions/index";

/**
 * A registered tool that no skill mentions is a tool nothing calls, and a
 * `pinned: true` entry in a budgeted catalogue is not free. `worktrees` shipped
 * that way: correct, tested, and unreachable from anything a reader would load.
 *
 * Matched with a boundary, not `includes`: `worktree` is a prefix of `worktrees`,
 * so a substring check would report the mutating tool reachable off the back of
 * a read-only mention — a test that cannot fail.
 */
const TOOLS = [
  "brain",
  "canvas",
  "comments",
  "history",
  "prose",
  "routing",
  "stack",
  "worktrees",
];

describe("every registered tool is reachable from some skill", () => {
  test("a name a leaf never mentions is a name no agent will find", async () => {
    const skills = await Effect.runPromise(load());
    const corpus = skills.map((one) => `${one.description}\n${one.content}`).join("\n");

    const unreachable = TOOLS.filter(
      (tool) => !new RegExp(`tools\\.spectre\\.${tool}(?![A-Za-z0-9])`).test(corpus),
    );

    expect(unreachable).toEqual([]);
  });

  test("every tool is in the spectre namespace, so the dotted path resolves", async () => {
    // The namespace is declared per tool and nothing else enforces it, so a
    // tool added without it lands at `tools.<name>` and looks fine everywhere.
    const ctx = { location: { project: { id: "p", directory: "/d", canonical: "/d" } } } as never;
    const registered = [
      (await import("../../tools/definitions/brain")).brain(ctx),
      (await import("../../tools/definitions/canvas")).canvases(ctx),
      (await import("../../tools/definitions/comments")).comments(ctx),
      (await import("../../tools/definitions/history")).historyTool(ctx),
      (await import("../../tools/definitions/prose")).prose(ctx),
      (await import("../../tools/definitions/routing")).routing(ctx),
      (await import("../../tools/definitions/stack")).stack(ctx),
      (await import("../../tools/definitions/worktrees")).worktrees(ctx),
    ];

    // Length is checked against TOOLS, not spelled out as literals, so adding a
    // tool cannot pass by leaving this array the length it was.
    expect(registered.map((tool) => tool.options?.namespace)).toEqual(
      TOOLS.map(() => "spectre"),
    );
    expect(registered).toHaveLength(TOOLS.length);
    expect(registered.every((tool) => tool.options?.codemode === true)).toBe(true);
  });
});
