import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { load } from "../../skills/definitions/index";

/**
 * A registered tool that no skill mentions is a tool nothing calls, and a
 * `pinned: true` entry in a budgeted catalogue is not free. `worktrees` shipped
 * that way: correct, tested, and unreachable from anything a reader would load.
 */
const TOOLS = ["comments", "history", "routing", "stack", "worktrees"];

describe("every registered tool is reachable from some skill", () => {
  test("a name a leaf never mentions is a name no agent will find", async () => {
    const skills = await Effect.runPromise(load());
    const corpus = skills.map((one) => `${one.description}\n${one.content}`).join("\n");

    const unreachable = TOOLS.filter((tool) => !corpus.includes(`tools.spectre.${tool}`));

    expect(unreachable).toEqual([]);
  });
});
