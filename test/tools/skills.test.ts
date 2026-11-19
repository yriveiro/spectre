import { describe, expect, test } from "bun:test";
import type { Tool } from "@opencode/plugin/effect";
import { Effect, Schema } from "effect";
import { SkillsInput, SkillsOutput, skillsTool } from "../../tools/definitions/skills";

const context = {
  sessionID: "ses_test" as never,
  agent: "spectre" as never,
  messageID: "msg_test" as never,
  id: "call_test" as never,
  progress: () => Effect.void,
} as Tool.Context;

const run = async (input: typeof SkillsInput.Type) => {
  const result = await Effect.runPromise(skillsTool().execute(input, context));
  if (result.output === undefined) throw new Error("expected output");
  return result.output;
};

describe("tools.spectre.skills schema boundary", () => {
  test("decodes inspect without action, search without action, and list with empty object", () => {
    const inspectDecoded = Schema.decodeUnknownOption(SkillsInput)({ id: "opencode-platform" });
    const searchDecoded = Schema.decodeUnknownOption(SkillsInput)({ query: "solidjs reactivity" });
    const listDecoded = Schema.decodeUnknownOption(SkillsInput)({ category: "playbook" });

    expect(inspectDecoded._tag).toBe("Some");
    expect(searchDecoded._tag).toBe("Some");
    expect(listDecoded._tag).toBe("Some");
    if (inspectDecoded._tag === "Some") expect("id" in inspectDecoded.value).toBe(true);
    if (searchDecoded._tag === "Some") expect("query" in searchDecoded.value).toBe(true);
    if (listDecoded._tag === "Some") expect("id" in listDecoded.value).toBe(false);

    expect(Schema.toJsonSchemaDocument(SkillsInput).schema).toBeDefined();
    expect(Schema.toJsonSchemaDocument(SkillsOutput).schema).toBeDefined();
  });
});

describe("tools.spectre.skills execution", () => {
  test("default list returns all 49 pull-tier skills (25 playbooks + 24 domain) sorted alphabetically", async () => {
    const out = await run({});
    expect(out.status).toBe("listed");
    if (out.status !== "listed") return;

    expect(out.tier).toBe("pull");
    expect(out.count).toBe(49);
    expect(out.items[0]?.id).toBe("architect");
    expect(out.items.map((item) => item.tier).every((tier) => tier === "pull")).toBe(true);
  });

  test("filters list by pull category, push group, and enforces contradictory filters together", async () => {
    const stackOut = await run({ category: "stack" });
    expect(stackOut.status).toBe("listed");
    if (stackOut.status === "listed") {
      expect(stackOut.items.map((item) => item.id)).toEqual([
        "effect-best-practices",
        "elysia-best-practices",
        "opencode-platform",
        "solidjs-best-practices",
        "typescript-best-practices",
      ]);
    }

    const playbooksOut = await run({ category: "playbook" });
    expect(playbooksOut.status).toBe("listed");
    if (playbooksOut.status === "listed") {
      expect(playbooksOut.tier).toBe("pull");
      expect(playbooksOut.count).toBe(25);
      expect(playbooksOut.items.some((item) => item.id === "worktree-cleanup")).toBe(true);
    }

    const leavesOut = await run({ group: "leaf" });
    expect(leavesOut.status).toBe("listed");
    if (leavesOut.status === "listed") {
      expect(leavesOut.tier).toBe("push");
      expect(leavesOut.count).toBe(32);
    }

    const contradictory = await run({ group: "leaf", category: "stack" });
    expect(contradictory.status).toBe("listed");
    if (contradictory.status === "listed") {
      expect(contradictory.count).toBe(0);
    }
  });

  test("ranks skills accurately, caps default limit at 5, and filters stop words", async () => {
    const prVisual = await run({
      query: "walk through pull request diff visually in a page",
    });
    expect(prVisual.status).toBe("matched");
    if (prVisual.status === "matched") {
      expect(prVisual.items[0]?.id).toBe("pr-canvas");
      expect(prVisual.items[0]?.category).toBe("visual");
      expect(prVisual.items.length).toBeLessThanOrEqual(5);
    }

    const stopWordQuery = await run({
      query: "do I write a failing test for this bug",
    });
    expect(stopWordQuery.status).toBe("matched");
    if (stopWordQuery.status === "matched") {
      expect(stopWordQuery.total).toBeLessThan(60);
      expect(stopWordQuery.items[0]?.id).toBe("tdd");
    }

    const exactHow = await run({ query: "how" });
    expect(exactHow.status).toBe("matched");
    if (exactHow.status === "matched") {
      expect(exactHow.items[0]?.id).toBe("how");
    }

    const bugPlaybook = await run({
      query: "reproduce a defect and isolate root cause",
      category: "playbook",
      limit: 3,
    });
    expect(bugPlaybook.status).toBe("matched");
    if (bugPlaybook.status === "matched") {
      expect(bugPlaybook.items[0]?.id).toBe("playbook-bug-fix");
      expect(bugPlaybook.items.every((item) => item.category === "playbook")).toBe(true);
    }
  });

  test("inspects headings, previews, and docs references without leaking plugin .ts files, and suggests typos", async () => {
    const router = await run({ id: "model-router", previewLines: 6 });
    expect(router.status).toBe("inspected");
    if (router.status === "inspected") {
      expect(router.tier).toBe("push");
      expect(router.group).toBe("leaf");
      expect(router.headings[0]).toBe("# model-router");
      expect(router.preview.split("\n").length).toBeLessThanOrEqual(6);
      expect(router.references).toContain("references/answer-shape.md");
      expect(router.loadWith).toBe('skill({ id: "model-router" })');
    }

    const effectSkill = await run({ id: "effect-best-practices", previewLines: 4 });
    expect(effectSkill.status).toBe("inspected");
    if (effectSkill.status === "inspected") {
      expect(effectSkill.references).toEqual([]);
    }

    const solidSkill = await run({ id: "solidjs-best-practices", previewLines: 4 });
    expect(solidSkill.status).toBe("inspected");
    if (solidSkill.status === "inspected") {
      expect(solidSkill.references.some((ref) => ref === "verified.ts")).toBe(false);
      expect(solidSkill.references.some((ref) => ref.startsWith("references/"))).toBe(true);
    }

    const missing = await run({ id: "solidjs-guide" });
    expect(missing.status).toBe("not-found");
    if (missing.status === "not-found") {
      expect(missing.suggestions).toContain("solidjs-best-practices");
    }

    const typo = await run({ id: "ripwir" });
    expect(typo.status).toBe("not-found");
    if (typo.status === "not-found") {
      expect(typo.suggestions).toContain("ripwire");
    }
  });
});
