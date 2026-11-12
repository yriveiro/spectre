import { describe, expect, test } from "bun:test";
import { firstChild, pickStep, resolveInput, type Message } from "../script";
import { loadScenario } from "../scenario";

const correction = await loadScenario(`${import.meta.dir}/../scenarios/correction.json`);
const newUnit = await loadScenario(`${import.meta.dir}/../scenarios/new-unit.json`);

const parent = (prompt: string): ReadonlyArray<Message> => [
  { role: "system", content: "You are opencode, a coding agent." },
  { role: "user", content: prompt },
];

const child = (prompt: string): ReadonlyArray<Message> => [
  { role: "system", content: "You are a subagent spawned by another session. Do the task." },
  { role: "user", content: prompt },
];

describe("the script follows the side of the subagent boundary", () => {
  test("the parent's first prompt picks the first subagent call", () => {
    const step = pickStep(correction, parent(correction.turns[0]!.prompt));
    expect(step?.tool).toBe("subagent");
    expect(step?.input?.agent).toBe("spectre");
  });

  test("the child's first task picks the write, not the parent's call", () => {
    const step = pickStep(correction, child("Create /workspace/notes.txt with three lines."));
    expect(step?.tool).toBe("write");
    expect(step?.input?.path).toBe("/workspace/notes.txt");
  });

  test("the parent's second prompt picks the continuing call", () => {
    const messages: ReadonlyArray<Message> = [
      ...parent(correction.turns[0]!.prompt),
      { role: "tool", content: '<subagent sessionID="ses_child" state="completed">done</subagent>' },
      { role: "user", content: correction.turns[1]!.prompt },
    ];
    const step = pickStep(correction, messages);
    expect(step?.tool).toBe("subagent");
    expect(step?.input?.sessionID).toBe("$firstChild");
    expect(firstChild(messages)).toBe("ses_child");
    expect(resolveInput(step?.input ?? {}, firstChild(messages)).sessionID).toBe("ses_child");
  });

  test("the child's second task picks the corrective write", () => {
    const step = pickStep(correction, child("Edit /workspace/notes.txt so it has four lines."));
    expect(step?.tool).toBe("write");
    expect(step?.input?.content).toContain("BETA-42");
  });
});

describe("a new unit does not continue the first child", () => {
  test("the second parent prompt has no sessionID", () => {
    const messages: ReadonlyArray<Message> = [
      ...parent(newUnit.turns[0]!.prompt),
      { role: "tool", content: '<subagent sessionID="ses_first" state="completed">done</subagent>' },
      { role: "user", content: newUnit.turns[1]!.prompt },
    ];
    const step = pickStep(newUnit, messages);
    expect(step?.tool).toBe("subagent");
    expect(step?.input?.sessionID).toBeUndefined();
  });

  test("the two child tasks pick their own writes", () => {
    expect(pickStep(newUnit, child("Create /workspace/a.txt with alpha."))?.input?.path).toBe(
      "/workspace/a.txt",
    );
    expect(pickStep(newUnit, child("Create /workspace/b.txt with beta."))?.input?.path).toBe(
      "/workspace/b.txt",
    );
  });
});
