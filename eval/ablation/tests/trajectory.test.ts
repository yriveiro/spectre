import { describe, expect, test } from "bun:test";
import type { SessionMessageAssistant, SessionMessageAssistantTool } from "@opencode/client";
import type { Transcript } from "../../opencode";
import { loadScenario } from "../scenario";
import { decodeShellOutcome, extractTrajectory } from "../trajectory";

const SCENARIO_PATH = `${import.meta.dir}/../scenarios/tdd-bugfix.json`;

const makeToolPart = (input: {
  readonly id: string;
  readonly name: string;
  readonly created: number;
  readonly ran?: number;
  readonly completed?: number;
  readonly args: Record<string, unknown>;
  readonly status?: "completed" | "error" | "running";
  readonly text?: string;
  readonly metadata?: Record<string, unknown>;
  readonly output?: Record<string, unknown>;
  readonly errorMessage?: string;
}): SessionMessageAssistantTool => {
  const status = input.status ?? "completed";
  const baseState =
    status === "error"
      ? {
          status: "error" as const,
          input: input.args,
          error: { type: "tool", message: input.errorMessage ?? "tool failed" },
          ...(input.text === undefined
            ? {}
            : { content: [{ type: "text" as const, text: input.text }] }),
          ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
        }
      : status === "running"
        ? {
            status: "running" as const,
            input: input.args,
            metadata: input.metadata ?? {},
          }
        : {
            status: "completed" as const,
            input: input.args,
            content: [{ type: "text" as const, text: input.text ?? "" }],
            ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
            ...(input.output === undefined ? {} : { output: input.output }),
          };

  return {
    type: "tool",
    id: input.id,
    name: input.name,
    state: baseState as SessionMessageAssistantTool["state"],
    time: {
      created: input.created,
      ...(input.ran === undefined ? {} : { ran: input.ran }),
      ...(input.completed === undefined ? {} : { completed: input.completed }),
    },
  };
};

const makeAssistant = (
  id: string,
  parts: ReadonlyArray<SessionMessageAssistantTool>,
  options?: { readonly cost?: number; readonly variant?: string },
): SessionMessageAssistant =>
  ({
    id,
    type: "assistant",
    agent: "spectre",
    model: {
      providerID: "opencode-go",
      id: "kimi-k3",
      ...(options?.variant === undefined ? {} : { variant: options.variant }),
    },
    time: { created: 1000, completed: 5000 },
    content: [...parts],
    finish: "stop",
    cost: options?.cost ?? 0,
    tokens: {
      input: 1000,
      output: 200,
      reasoning: 50,
      cache: { read: 400, write: 100 },
    },
  }) as unknown as SessionMessageAssistant;

const makeTranscript = (
  messages: ReadonlyArray<SessionMessageAssistant>,
  activated: ReadonlyArray<string> = [],
): Transcript => ({
  activated,
  messages,
});

describe("v2.4.2 wire decoding and causal trajectory grading", () => {
  test("decodes structured Code Mode execute metadata.toolCalls and shell metadata.exit / output.exitCode", async () => {
    const scenario = await loadScenario(SCENARIO_PATH);
    const parent = makeTranscript(
      [
        makeAssistant(
          "msg-1",
          [
            makeToolPart({
              id: "call-exec",
              name: "execute",
              created: 100,
              completed: 120,
              args: {
                code: 'await tools.spectre.skills({ id: "tdd" }); // tools.spectre.routing({})',
              },
              text: '{"status":"inspected","id":"tdd"}',
              metadata: {
                toolCalls: [
                  { tool: "spectre.skills", status: "completed", input: { id: "tdd" } },
                ],
              },
            }),
            makeToolPart({
              id: "call-skill",
              name: "skill",
              created: 130,
              completed: 140,
              args: { id: "tdd" },
              text: "<skill_content>...</skill_content>",
            }),
            makeToolPart({
              id: "call-edit-spec",
              name: "edit",
              created: 200,
              completed: 210,
              args: { path: "/tmp/work/spec/limiter.spec.ts" },
              text: "ok",
            }),
            makeToolPart({
              id: "call-red",
              name: "shell",
              created: 220,
              completed: 250,
              args: { command: "bun run check" },
              text: "4 pass\n1 fail\nExpected: true\nReceived: false\nExit code: 1",
              metadata: { status: "completed", truncated: false, exit: 1 },
            }),
            makeToolPart({
              id: "call-edit-src",
              name: "edit",
              created: 260,
              completed: 270,
              args: { path: "/tmp/work/src/limiter.ts" },
              text: "ok",
            }),
            makeToolPart({
              id: "call-green",
              name: "shell",
              created: 280,
              completed: 310,
              args: { command: "bun test" },
              text: "5 pass\n0 fail",
              output: { exitCode: 0, wallTimeSeconds: 0.05, output: "5 pass\n0 fail" },
              metadata: { status: "completed", truncated: false, exit: 0 },
            }),
          ],
          { cost: 0, variant: "high" },
        ),
      ],
      ["tdd"],
    );

    const extracted = extractTrajectory({
      scenario,
      parent,
      children: new Map(),
      workspaceDir: "/tmp/work",
    });

    expect(extracted.activation.targetSkillLoaded).toBe(true);
    expect(extracted.activation.activatedSkills).toEqual(["tdd"]);
    expect(extracted.trajectory.codemodeCalls).toEqual([
      {
        tool: "spectre.skills",
        status: "completed",
        input: { id: "tdd" },
        wireFormat: "structured",
      },
    ]);
    expect(extracted.trajectory.causalRedBeforeEdit).toBe(true);
    expect(extracted.trajectory.testEditedBeforeRedRun).toBe(true);
    expect(extracted.trajectory.redRunCompletedBeforeProdEdit).toBe(true);
    expect(extracted.trajectory.greenRunAfterLastProdEdit).toBe(true);
    expect(extracted.trajectory.redWitnessRejectionReasons).toEqual([]);
    expect(extracted.trajectory.toolErrors).toBe(0);
    expect(extracted.cost.hostRecordedUsd).toBe(0);
    expect(extracted.cost.usage.cacheRead).toBe(400);
    expect(extracted.cost.usage.cacheWrite).toBe(100);
    expect(extracted.cost.modelVariant).toBe("high");
  });

  test("rejects syntax/setup failures, edit-before-test, and overlapping red runs finishing after edit", async () => {
    const scenario = await loadScenario(SCENARIO_PATH);

    const syntaxRed = extractTrajectory({
      scenario,
      parent: makeTranscript([
        makeAssistant("m1", [
          makeToolPart({
            id: "c1",
            name: "edit",
            created: 100,
            completed: 110,
            args: { path: "spec/limiter.spec.ts" },
          }),
          makeToolPart({
            id: "c2",
            name: "shell",
            created: 120,
            completed: 150,
            args: { command: "bun test" },
            text: "SyntaxError: Unexpected token '}' at spec/limiter.spec.ts:28",
            metadata: { status: "completed", exit: 1 },
          }),
          makeToolPart({
            id: "c3",
            name: "edit",
            created: 160,
            completed: 170,
            args: { path: "src/limiter.ts" },
          }),
          makeToolPart({
            id: "c4",
            name: "shell",
            created: 180,
            completed: 200,
            args: { command: "bun test" },
            text: "5 pass\n0 fail",
            metadata: { status: "completed", exit: 0 },
          }),
        ]),
      ]),
      children: new Map(),
    });
    expect(syntaxRed.trajectory.causalRedBeforeEdit).toBe(false);
    expect(syntaxRed.trajectory.redWitnessRejectionReasons).toContain(
      "red_test_was_syntax_or_setup_error",
    );

    const editFirst = extractTrajectory({
      scenario,
      parent: makeTranscript([
        makeAssistant("m1", [
          makeToolPart({
            id: "c1",
            name: "edit",
            created: 100,
            completed: 110,
            args: { path: "src/limiter.ts" },
          }),
          makeToolPart({
            id: "c2",
            name: "edit",
            created: 120,
            completed: 130,
            args: { path: "spec/limiter.spec.ts" },
          }),
          makeToolPart({
            id: "c3",
            name: "shell",
            created: 140,
            completed: 160,
            args: { command: "bun test" },
            text: "5 pass\n0 fail",
            metadata: { status: "completed", exit: 0 },
          }),
        ]),
      ]),
      children: new Map(),
    });
    expect(editFirst.trajectory.causalRedBeforeEdit).toBe(false);
    expect(editFirst.trajectory.redWitnessRejectionReasons).toContain("prod_edit_before_red_test");

    const overlappingRed = extractTrajectory({
      scenario,
      parent: makeTranscript([
        makeAssistant("m1", [
          makeToolPart({
            id: "c1",
            name: "edit",
            created: 100,
            completed: 110,
            args: { path: "spec/limiter.spec.ts" },
          }),
          makeToolPart({
            id: "c2",
            name: "shell",
            created: 120,
            completed: 200,
            args: { command: "bun test" },
            text: "4 pass\n1 fail\nExpected: true\nReceived: false",
            metadata: { status: "completed", exit: 1 },
          }),
          makeToolPart({
            id: "c3",
            name: "edit",
            created: 150,
            completed: 160,
            args: { path: "src/limiter.ts" },
          }),
          makeToolPart({
            id: "c4",
            name: "shell",
            created: 210,
            completed: 230,
            args: { command: "bun test" },
            text: "5 pass\n0 fail",
            metadata: { status: "completed", exit: 0 },
          }),
        ]),
      ]),
      children: new Map(),
    });
    expect(overlappingRed.trajectory.causalRedBeforeEdit).toBe(false);
    expect(overlappingRed.trajectory.redWitnessRejectionReasons).toContain(
      "red_test_not_completed_before_prod_edit",
    );
  });

  test("never treats missing exit, timeout, signal, killed, or backgrounded shell calls as passed", () => {
    expect(
      decodeShellOutcome(
        makeToolPart({
          id: "s1",
          name: "shell",
          created: 1,
          completed: 2,
          args: { command: "bun test" },
          metadata: { status: "completed" },
        }),
      ),
    ).toEqual({ kind: "unknown" });

    expect(
      decodeShellOutcome(
        makeToolPart({
          id: "s2",
          name: "shell",
          created: 1,
          completed: 2,
          args: { command: "bun test" },
          metadata: { status: "completed", timeout: true, exit: 0 },
        }),
      ).kind,
    ).toBe("timeout");

    expect(
      decodeShellOutcome(
        makeToolPart({
          id: "s3",
          name: "shell",
          created: 1,
          completed: 2,
          args: { command: "bun test" },
          metadata: { status: "completed", signal: "SIGTERM" },
        }),
      ),
    ).toEqual({ kind: "signal", signal: "SIGTERM" });

    expect(
      decodeShellOutcome(
        makeToolPart({
          id: "s4",
          name: "shell",
          created: 1,
          completed: 2,
          args: { command: "bun test" },
          metadata: { status: "running", shellID: "sh_1" },
        }),
      ),
    ).toEqual({ kind: "backgrounded", shellID: "sh_1" });

    expect(
      decodeShellOutcome(
        makeToolPart({
          id: "s5",
          name: "shell",
          created: 1,
          completed: 2,
          args: { command: "bun test" },
          metadata: { status: "completed", killed: true },
        }),
      ).kind,
    ).toBe("killed");
  });

  test("rejects overlapping production edits when an earlier-created edit finishes after the green run", async () => {
    const scenario = await loadScenario(SCENARIO_PATH);

    const overlappingProd = extractTrajectory({
      scenario,
      parent: makeTranscript([
        makeAssistant("m1", [
          makeToolPart({
            id: "c1",
            name: "edit",
            created: 100,
            ran: 100,
            completed: 110,
            args: { path: "spec/limiter.spec.ts" },
          }),
          makeToolPart({
            id: "c2",
            name: "shell",
            created: 120,
            ran: 120,
            completed: 150,
            args: { command: "bun test" },
            text: "4 pass\n1 fail\nExpected: true\nReceived: false",
            metadata: { status: "completed", exit: 1 },
          }),
          makeToolPart({
            id: "c3",
            name: "edit",
            created: 160,
            ran: 160,
            completed: 250,
            args: { path: "src/limiter.ts" },
          }),
          makeToolPart({
            id: "c4",
            name: "edit",
            created: 170,
            ran: 170,
            completed: 180,
            args: { path: "src/limiter.ts" },
          }),
          makeToolPart({
            id: "c5",
            name: "shell",
            created: 190,
            ran: 190,
            completed: 210,
            args: { command: "bun test" },
            text: "5 pass\n0 fail",
            metadata: { status: "completed", exit: 0 },
          }),
        ]),
      ]),
      children: new Map(),
    });

    expect(overlappingProd.trajectory.greenRunAfterLastProdEdit).toBe(false);
    expect(overlappingProd.trajectory.causalRedBeforeEdit).toBe(false);
    expect(overlappingProd.trajectory.redWitnessRejectionReasons).toContain(
      "no_green_test_after_last_prod_edit",
    );

    const greenAfterAllProdEdits = extractTrajectory({
      scenario,
      parent: makeTranscript([
        makeAssistant("m1", [
          makeToolPart({
            id: "c1",
            name: "edit",
            created: 100,
            ran: 100,
            completed: 110,
            args: { path: "spec/limiter.spec.ts" },
          }),
          makeToolPart({
            id: "c2",
            name: "shell",
            created: 120,
            ran: 120,
            completed: 150,
            args: { command: "bun test" },
            text: "4 pass\n1 fail\nExpected: true\nReceived: false",
            metadata: { status: "completed", exit: 1 },
          }),
          makeToolPart({
            id: "c3",
            name: "edit",
            created: 160,
            ran: 160,
            completed: 250,
            args: { path: "src/limiter.ts" },
          }),
          makeToolPart({
            id: "c4",
            name: "edit",
            created: 170,
            ran: 170,
            completed: 180,
            args: { path: "src/limiter.ts" },
          }),
          makeToolPart({
            id: "c5",
            name: "shell",
            created: 190,
            ran: 260,
            completed: 290,
            args: { command: "bun test" },
            text: "5 pass\n0 fail",
            metadata: { status: "completed", exit: 0 },
          }),
        ]),
      ]),
      children: new Map(),
    });

    expect(greenAfterAllProdEdits.trajectory.greenRunAfterLastProdEdit).toBe(true);
    expect(greenAfterAllProdEdits.trajectory.causalRedBeforeEdit).toBe(true);
    expect(greenAfterAllProdEdits.trajectory.redWitnessRejectionReasons).toEqual([]);
  });

  test("rejects unsettled or errored production edits as a valid green state", async () => {
    const scenario = await loadScenario(SCENARIO_PATH);

    const unsettledProd = extractTrajectory({
      scenario,
      parent: makeTranscript([
        makeAssistant("m1", [
          makeToolPart({
            id: "c1",
            name: "edit",
            created: 100,
            ran: 100,
            completed: 110,
            args: { path: "spec/limiter.spec.ts" },
          }),
          makeToolPart({
            id: "c2",
            name: "shell",
            created: 120,
            ran: 120,
            completed: 150,
            args: { command: "bun test" },
            text: "4 pass\n1 fail\nExpected: true\nReceived: false",
            metadata: { status: "completed", exit: 1 },
          }),
          makeToolPart({
            id: "c3",
            name: "edit",
            created: 160,
            ran: 160,
            completed: 170,
            args: { path: "src/limiter.ts" },
          }),
          makeToolPart({
            id: "c4",
            name: "edit",
            created: 175,
            ran: 175,
            status: "running",
            args: { path: "src/limiter.ts" },
          }),
          makeToolPart({
            id: "c5",
            name: "shell",
            created: 200,
            ran: 200,
            completed: 220,
            args: { command: "bun test" },
            text: "5 pass\n0 fail",
            metadata: { status: "completed", exit: 0 },
          }),
        ]),
      ]),
      children: new Map(),
    });

    expect(unsettledProd.trajectory.greenRunAfterLastProdEdit).toBe(false);
    expect(unsettledProd.trajectory.causalRedBeforeEdit).toBe(false);

    const erroredProd = extractTrajectory({
      scenario,
      parent: makeTranscript([
        makeAssistant("m1", [
          makeToolPart({
            id: "c1",
            name: "edit",
            created: 100,
            ran: 100,
            completed: 110,
            args: { path: "spec/limiter.spec.ts" },
          }),
          makeToolPart({
            id: "c2",
            name: "shell",
            created: 120,
            ran: 120,
            completed: 150,
            args: { command: "bun test" },
            text: "4 pass\n1 fail\nExpected: true\nReceived: false",
            metadata: { status: "completed", exit: 1 },
          }),
          makeToolPart({
            id: "c3",
            name: "edit",
            created: 160,
            ran: 160,
            completed: 170,
            args: { path: "src/limiter.ts" },
          }),
          makeToolPart({
            id: "c4",
            name: "edit",
            created: 175,
            ran: 175,
            completed: 185,
            status: "error",
            args: { path: "src/limiter.ts" },
          }),
          makeToolPart({
            id: "c5",
            name: "shell",
            created: 200,
            ran: 200,
            completed: 220,
            args: { command: "bun test" },
            text: "5 pass\n0 fail",
            metadata: { status: "completed", exit: 0 },
          }),
        ]),
      ]),
      children: new Map(),
    });

    expect(erroredProd.trajectory.greenRunAfterLastProdEdit).toBe(false);
    expect(erroredProd.trajectory.causalRedBeforeEdit).toBe(false);
  });
});
