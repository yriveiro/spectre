import { describe, expect, test } from "bun:test";
import type { Message } from "../../opencode";
import { assertScenario, observed, subagentCalls, type SubagentCall } from "../observe";
import { loadScenario } from "../scenario";

const correction = await loadScenario(`${import.meta.dir}/../scenarios/correction.json`);
const newUnit = await loadScenario(`${import.meta.dir}/../scenarios/new-unit.json`);

const part = (input: {
  readonly sessionID?: string;
  readonly output?: string;
  readonly status?: string;
}) => ({
  type: "tool",
  name: "subagent",
  state: {
    status: input.status ?? "completed",
    input: {
      agent: "spectre",
      description: "task",
      prompt: "do it",
      ...(input.sessionID === undefined ? {} : { sessionID: input.sessionID }),
    },
    ...(input.output === undefined ? {} : { metadata: { sessionID: input.output } }),
  },
});

const transcript = (parts: ReadonlyArray<ReturnType<typeof part>>): ReadonlyArray<Message> =>
  parts.map((one) => ({ content: [one] })) as unknown as ReadonlyArray<Message>;

describe("the parent transcript yields the subagent calls", () => {
  test("a first call has an output id and no input id", () => {
    const calls = subagentCalls(transcript([part({ output: "ses_a" })]));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.sessionID).toBeUndefined();
    expect(calls[0]?.outputSessionID).toBe("ses_a");
  });

  test("a resumed call carries the child id in its input", () => {
    const calls = subagentCalls(transcript([part({ output: "ses_a" }), part({ sessionID: "ses_a", output: "ses_a" })]));
    expect(calls[1]?.sessionID).toBe("ses_a");
    expect(calls[1]?.outputSessionID).toBe("ses_a");
  });
});

const runOf = (calls: ReadonlyArray<SubagentCall>, files: Readonly<Record<string, string>>) =>
  observed({ scenario: correction, mode: "mock", model: "mock/resume", calls, files });

describe("the correction assertion can pass and fail", () => {
  const passing: Array<SubagentCall> = [
    { agent: "spectre", outputSessionID: "ses_a", status: "completed" },
    { agent: "spectre", sessionID: "ses_a", outputSessionID: "ses_a", status: "completed" },
  ];

  test("two calls on one child, with the final file, pass", () => {
    const run = runOf(passing, { "notes.txt": "alpha\nBETA-42\ngamma\nORCHID-42" });
    expect(assertScenario(correction, run)).toEqual([]);
  });

  test("a second call with no sessionID fails", () => {
    const run = runOf(
      [passing[0]!, { agent: "spectre", outputSessionID: "ses_b", status: "completed" }],
      { "notes.txt": "alpha\nBETA-42\ngamma\nORCHID-42" },
    );
    const findings = assertScenario(correction, run);
    expect(findings).toContain("call 2: no input sessionID, so the parent spawned a new child");
    expect(findings).toContain("child sessions: expected 1, got 2");
  });

  test("a second call on a different child fails", () => {
    const run = runOf(
      [passing[0]!, { agent: "spectre", sessionID: "ses_b", outputSessionID: "ses_b", status: "completed" }],
      { "notes.txt": "alpha\nBETA-42\ngamma\nORCHID-42" },
    );
    expect(assertScenario(correction, run)).toContain(
      "call 2: the input sessionID is not the first child's id",
    );
  });

  test("a wrong file fails with the expected value", () => {
    const run = runOf(passing, { "notes.txt": "alpha\nbeta\ngamma" });
    expect(assertScenario(correction, run)).toContain(
      'notes.txt: expected "alpha\\nBETA-42\\ngamma\\nORCHID-42", got "alpha\\nbeta\\ngamma"',
    );
  });
});

describe("the new-unit assertion can pass and fail", () => {
  const files = { "a.txt": "alpha", "b.txt": "beta" };
  const first: SubagentCall = { agent: "spectre", outputSessionID: "ses_a", status: "completed" };

  test("two calls on two children pass", () => {
    const run = observed({
      scenario: newUnit,
      mode: "mock",
      model: "mock/resume",
      calls: [first, { agent: "spectre", outputSessionID: "ses_b", status: "completed" }],
      files,
    });
    expect(assertScenario(newUnit, run)).toEqual([]);
  });

  test("continuing the first child fails", () => {
    const run = observed({
      scenario: newUnit,
      mode: "mock",
      model: "mock/resume",
      calls: [first, { agent: "spectre", sessionID: "ses_a", outputSessionID: "ses_a", status: "completed" }],
      files,
    });
    const findings = assertScenario(newUnit, run);
    expect(findings).toContain("call 2: continued the first child, but the unit is new");
    expect(findings).toContain("child sessions: expected 2, got 1");
  });
});
