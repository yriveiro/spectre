import { describe, expect, test } from "bun:test";

/**
 * A delegated result that is wrong is corrected in the child that produced it,
 * by calling `subagent` again with the `sessionID` the first call returned. The
 * hub names the rule, the router owns the mechanics, and no leaf keeps the old
 * instruction to spawn a fresh worker.
 */

const DIR = "skills/definitions";
const HUB = `${DIR}/spectre-mode/SKILL.md`;
const ROUTER = `${DIR}/model-router/SKILL.md`;
const AGENT = "agents/definitions/spectre.ts";

/** Prose is hard-wrapped, so a phrase can cross a line without changing. */
const flat = (text: string): string => text.replace(/\s+/g, " ");

describe("the hub names the rule", () => {
  test("the trigger that fires on a delegated result names the router", async () => {
    const row = (await Bun.file(HUB).text()).match(/^\|.*delegated result needs correcting.*\|$/m);
    expect(row?.[0]).toContain("model-router");
  });
});

describe("the agent states it too", () => {
  test("a rejected result is a follow-up that omits the model", async () => {
    const agent = flat(await Bun.file(AGENT).text());
    expect(agent).toContain("sessionID");
    expect(agent).toContain("follow-up");
    // The agent file is a template literal, so its backticks carry a backslash.
    expect(agent).toContain("omit \\`model\\`");
  });
});

describe("the router owns the mechanics", () => {
  test("the body carries the rule as a section", async () => {
    const body = flat(await Bun.file(ROUTER).text());
    expect(body).toContain("## A correction is a follow-up, not a new child");
    expect(body).toContain("reviewer's `sessionID`");
  });

  test("the call page states who may continue a child and what it costs", async () => {
    const page = flat(await Bun.file(`${DIR}/model-router/references/subagent-call.md`).text());
    expect(page).toContain("Only the direct parent");
    expect(page).toContain("keeps its model");
  });
});

describe("no leaf keeps the old instruction", () => {
  test("code-hygiene corrects Sicko in the same session", async () => {
    const body = flat(await Bun.file(`${DIR}/code-hygiene/SKILL.md`).text());
    expect(body).toContain("same Sicko session");
    expect(body).not.toContain("rerun one rejected report");
  });

  test("swarm corrects a worker in the same session", async () => {
    const body = flat(await Bun.file(`${DIR}/swarm/SKILL.md`).text());
    expect(body).toContain("same `sessionID`");
    expect(body).not.toContain("rerun that worker");
  });

  test("guard-the-context-window corrects the same child", async () => {
    const body = flat(await Bun.file(`${DIR}/principle-guard-the-context-window/SKILL.md`).text());
    expect(body).toContain("same child");
  });
});
