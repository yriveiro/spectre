import { describe, expect, test } from "bun:test";
import type { SessionMessageAssistant } from "@opencode/client";
import type { Transcript } from "../../opencode";
import { observeTranscript } from "../observe";
import {
  type DelegationScenario,
  listScenarios,
  parseScenario,
  selectScenarios,
} from "../scenario";
import { compareArms, detectFlips, formatComparisonTable, scoreTrial } from "../score";

const must = <T>(value: T | undefined, label: string): T => {
  if (value === undefined) throw new Error(`missing ${label}`);
  return value;
};

const msg = (
  parts: SessionMessageAssistant["content"],
  tokens?: {
    input: number;
    output: number;
    reasoning?: number;
    cacheRead?: number;
    cacheWrite?: number;
  },
  cost = 0,
): SessionMessageAssistant =>
  ({
    type: "assistant",
    content: parts,
    tokens:
      tokens === undefined
        ? undefined
        : {
            input: tokens.input,
            output: tokens.output,
            reasoning: tokens.reasoning ?? 0,
            cache: { read: tokens.cacheRead ?? 0, write: tokens.cacheWrite ?? 0 },
          },
    cost,
  }) as unknown as SessionMessageAssistant;

const toolPart = (input: {
  name: string;
  created: number;
  args?: Record<string, unknown>;
  status?: "completed" | "error";
  metadata?: Record<string, unknown>;
  content?: Array<{ type: "text"; text: string }>;
}) =>
  ({
    type: "tool",
    name: input.name,
    time: { created: input.created },
    state: {
      status: input.status ?? "completed",
      input: input.args ?? {},
      metadata: input.metadata ?? {},
      content: input.content ?? [],
    },
  }) as unknown as SessionMessageAssistant["content"][number];

const textPart = (text: string) =>
  ({ type: "text", text }) as unknown as SessionMessageAssistant["content"][number];

describe("eval/delegation/scenario", () => {
  test("loads all 7 scenarios across all 3 slices", async () => {
    const scenarios = await listScenarios();
    expect(scenarios.length).toBe(7);

    const bySlice = new Map<string, number>();
    for (const scenario of scenarios) {
      bySlice.set(scenario.slice, (bySlice.get(scenario.slice) ?? 0) + 1);
    }

    expect(bySlice.get("bounded-delegate")).toBe(2);
    expect(bySlice.get("worker-escalate")).toBe(2);
    expect(bySlice.get("inline-negative")).toBe(3);
  });

  test("selectScenarios filters by id and rejects unknown ids", async () => {
    const selected = await selectScenarios(["bounded-rename-4files", "inline-single-file-why"]);
    expect(selected.map((s) => s.id)).toEqual(["bounded-rename-4files", "inline-single-file-why"]);

    await expect(selectScenarios(["does-not-exist"])).rejects.toThrow(/no scenario/);
  });

  test("parseScenario rejects path traversal and absolute paths", () => {
    const base = {
      id: "bad-path",
      slice: "inline-negative",
      description: "invalid path test",
      spectreConfig: { models: { a: "p/m" }, priority: ["a"] },
      turns: [{ prompt: "hello" }],
      expect: { expectOperatorDelegation: false },
    };

    expect(() => parseScenario({ ...base, setup: { "../escape.ts": "x" } }, "test.json")).toThrow(
      /inside the workspace/,
    );

    expect(() => parseScenario({ ...base, setup: { "/etc/passwd": "x" } }, "test.json")).toThrow(
      /relative to the workspace/,
    );
  });
});

describe("eval/delegation/observe", () => {
  test("extracts routing calls, operator spawns, escalations, and token shares", async () => {
    const scenario = must(
      (await selectScenarios(["trap-scope-boundary"]))[0],
      "trap-scope-boundary",
    );

    const parent: Transcript = {
      activated: ["model-router"],
      messages: [
        msg(
          [
            toolPart({
              name: "execute",
              created: 1,
              args: { code: "return await tools.spectre.routing({});" },
              metadata: { toolCalls: ["spectre.routing"] },
            }),
            toolPart({
              name: "subagent",
              created: 2,
              args: {
                agent: "operator",
                model: "opencode-go/minimax-m3.1-flash-free",
                description: "Update parser",
                prompt: "Scope: src/parser.ts",
              },
              metadata: { sessionID: "ses_child_1" },
              content: [
                {
                  type: "text",
                  text: `<subagent sessionID="ses_child_1" state="completed" description="Update parser">\nSTATUS: ESCALATE\nREASON: SCOPE\nBLOCKER: src/public.ts needs ParseResult union\nOPTIONS_OR_ATTEMPTS: Cannot edit src/public.ts under brief scope\nTOUCHED: none\nRECOMMENDED_NEXT: orchestrator_decision\n</subagent>`,
                },
              ],
            }),
          ],
          { input: 3000, output: 400, cacheRead: 1000 },
          0.02,
        ),
        msg(
          [
            toolPart({
              name: "subagent",
              created: 3,
              args: {
                agent: "operator",
                description: "Widen scope to public.ts",
                sessionID: "ses_child_1",
                prompt: "Widen scope to src/public.ts",
              },
              metadata: { sessionID: "ses_child_1" },
              content: [
                {
                  type: "text",
                  text: `<subagent sessionID="ses_child_1" state="completed" description="Widen scope">\nSTATUS: DONE\nTOUCHED: src/public.ts, src/parser.ts\nVERIFIED: bun test\nOUTCOME: Updated ParseResult\n</subagent>`,
                },
              ],
            }),
            textPart("Completed with widened scope."),
          ],
          { input: 3500, output: 200, cacheRead: 1500 },
          0.02,
        ),
      ],
    };

    const children = new Map<string, Transcript>([
      [
        "ses_child_1",
        {
          activated: [],
          messages: [
            msg(
              [
                textPart(
                  "STATUS: ESCALATE\nREASON: SCOPE\nBLOCKER: src/public.ts\nOPTIONS_OR_ATTEMPTS: none\nTOUCHED: none\nRECOMMENDED_NEXT: orchestrator_decision",
                ),
              ],
              { input: 2000, output: 300 },
              0.005,
            ),
            msg(
              [textPart("STATUS: DONE\nTOUCHED: src/public.ts\nVERIFIED: bun test\nOUTCOME: ok")],
              { input: 2500, output: 200 },
              0.005,
            ),
          ],
        },
      ],
    ]);

    const observed = observeTranscript({
      scenario,
      parent,
      children,
      workspaceFiles: {
        "src/public.ts": must(
          scenario.setup["src/public.ts" as keyof typeof scenario.setup],
          "src/public.ts",
        ).trimEnd(),
      },
    });

    expect(observed.loadedModelRouter).toBe(true);
    expect(observed.routingCalls).toBe(1);
    expect(observed.operatorSpawns).toBe(1);
    expect(observed.subagentCalls.length).toBe(2);
    expect(observed.subagentCalls[1]?.hasInputSessionID).toBe(true);
    expect(observed.subagentCalls[1]?.switchedModelOnResume).toBe(false);
    expect(observed.escalations).toEqual([
      {
        childSessionID: "ses_child_1",
        structured: true,
        reason: "SCOPE",
        childAssistantTurns: 2,
        continuedSameSession: true,
        upgradedModel: false,
      },
    ]);
    expect(observed.outOfScopeMutations).toEqual([]);
    expect(observed.parentPeakInputTokens).toBe(5000);
    expect(observed.parentTotalTokens).toBe(9600);
    expect(observed.childTotalTokens).toBe(5000);
    expect(observed.frontierTokenShare).toBeCloseTo(9600 / 14600, 5);
    expect(observed.catalogueCostUnits).toBeCloseTo(0.05, 5);
  });
});

describe("eval/delegation/score", () => {
  test("applies regret penalty when taskPassed is false", async () => {
    const scenario = must(
      (await selectScenarios(["bounded-rename-4files"]))[0],
      "bounded-rename-4files",
    );

    const failed = scoreTrial({
      scenario,
      arm: "candidate",
      trial: 1,
      verifyExitCode: 1,
      baselineCostUnits: 0.15,
      observed: {
        scenarioId: scenario.id,
        loadedModelRouter: true,
        routingCalls: 1,
        subagentCalls: [
          {
            agent: "operator",
            hasInputSessionID: false,
            outputSessionID: "ses_1",
            switchedModelOnResume: false,
            outputText: "",
          },
        ],
        operatorSpawns: 1,
        escalations: [],
        outOfScopeMutations: [],
        parentPeakInputTokens: 4000,
        parentTotalTokens: 5000,
        childTotalTokens: 8000,
        frontierTokenShare: 5000 / 13000,
        catalogueCostUnits: 0.04,
        parentFinalText: "done",
        parentFailed: false,
        workspaceFiles: {},
      },
    });

    expect(failed.taskPassed).toBe(false);
    expect(failed.regretAdjustedCostUnits).toBeCloseTo(0.19, 5);
  });

  test("detects scenario flips and evaluates release gates", async () => {
    const scenarios: ReadonlyArray<DelegationScenario> = await listScenarios();
    const bounded = must(
      scenarios.find((s) => s.id === "bounded-rename-4files"),
      "bounded",
    );
    const inline = must(
      scenarios.find((s) => s.id === "inline-single-file-why"),
      "inline",
    );
    const trap = must(
      scenarios.find((s) => s.id === "trap-ambiguity-contract"),
      "trap",
    );

    const subset = [bounded, inline, trap];

    const baselineTrials = [
      scoreTrial({
        scenario: bounded,
        arm: "baseline",
        trial: 1,
        verifyExitCode: 0,
        observed: {
          scenarioId: bounded.id,
          loadedModelRouter: false,
          routingCalls: 0,
          subagentCalls: [],
          operatorSpawns: 0,
          escalations: [],
          outOfScopeMutations: [],
          parentPeakInputTokens: 20000,
          parentTotalTokens: 25000,
          childTotalTokens: 0,
          frontierTokenShare: 1,
          catalogueCostUnits: 0.1,
          parentFinalText: "done",
          parentFailed: false,
          workspaceFiles: Object.fromEntries(
            Object.entries(bounded.expect.expectedFiles ?? {}).map(([k, v]) => [k, v.trimEnd()]),
          ),
        },
      }),
      scoreTrial({
        scenario: inline,
        arm: "baseline",
        trial: 1,
        observed: {
          scenarioId: inline.id,
          loadedModelRouter: false,
          routingCalls: 0,
          subagentCalls: [],
          operatorSpawns: 0,
          escalations: [],
          outOfScopeMutations: [],
          parentPeakInputTokens: 4000,
          parentTotalTokens: 5000,
          childTotalTokens: 0,
          frontierTokenShare: 1,
          catalogueCostUnits: 0.02,
          parentFinalText: "to avoid poisoning the cache",
          parentFailed: false,
          workspaceFiles: {},
        },
      }),
      scoreTrial({
        scenario: trap,
        arm: "baseline",
        trial: 1,
        verifyExitCode: 0,
        observed: {
          scenarioId: trap.id,
          loadedModelRouter: false,
          routingCalls: 0,
          subagentCalls: [],
          operatorSpawns: 0,
          escalations: [],
          outOfScopeMutations: [],
          parentPeakInputTokens: 12000,
          parentTotalTokens: 15000,
          childTotalTokens: 0,
          frontierTokenShare: 1,
          catalogueCostUnits: 0.08,
          parentFinalText: "done",
          parentFailed: false,
          workspaceFiles: {
            "src/parse-port.ts": must(
              trap.setup["src/parse-port.ts" as keyof typeof trap.setup],
              "src/parse-port.ts",
            ).trimEnd(),
            "src/parse-host.ts": must(
              trap.setup["src/parse-host.ts" as keyof typeof trap.setup],
              "src/parse-host.ts",
            ).trimEnd(),
          },
        },
      }),
    ];

    const candidatePassTrials = [
      scoreTrial({
        scenario: bounded,
        arm: "candidate",
        trial: 1,
        verifyExitCode: 0,
        baselineCostUnits: 0.1,
        observed: {
          scenarioId: bounded.id,
          loadedModelRouter: true,
          routingCalls: 1,
          subagentCalls: [
            {
              agent: "operator",
              hasInputSessionID: false,
              outputSessionID: "ses_b",
              switchedModelOnResume: false,
              outputText: "",
            },
          ],
          operatorSpawns: 1,
          escalations: [],
          outOfScopeMutations: [],
          parentPeakInputTokens: 6000,
          parentTotalTokens: 8000,
          childTotalTokens: 12000,
          frontierTokenShare: 8000 / 20000,
          catalogueCostUnits: 0.03,
          parentFinalText: "done",
          parentFailed: false,
          workspaceFiles: Object.fromEntries(
            Object.entries(bounded.expect.expectedFiles ?? {}).map(([k, v]) => [k, v.trimEnd()]),
          ),
        },
      }),
      scoreTrial({
        scenario: inline,
        arm: "candidate",
        trial: 1,
        baselineCostUnits: 0.02,
        observed: {
          scenarioId: inline.id,
          loadedModelRouter: false,
          routingCalls: 0,
          subagentCalls: [],
          operatorSpawns: 0,
          escalations: [],
          outOfScopeMutations: [],
          parentPeakInputTokens: 4000,
          parentTotalTokens: 5000,
          childTotalTokens: 0,
          frontierTokenShare: 1,
          catalogueCostUnits: 0.02,
          parentFinalText: "to avoid poisoning the cache",
          parentFailed: false,
          workspaceFiles: {},
        },
      }),
      scoreTrial({
        scenario: trap,
        arm: "candidate",
        trial: 1,
        verifyExitCode: 0,
        baselineCostUnits: 0.08,
        observed: {
          scenarioId: trap.id,
          loadedModelRouter: true,
          routingCalls: 1,
          subagentCalls: [
            {
              agent: "operator",
              hasInputSessionID: false,
              outputSessionID: "ses_t",
              switchedModelOnResume: false,
              outputText: "",
            },
            {
              agent: "operator",
              hasInputSessionID: true,
              inputSessionID: "ses_t",
              outputSessionID: "ses_t",
              switchedModelOnResume: false,
              outputText: "",
            },
          ],
          operatorSpawns: 1,
          escalations: [
            {
              childSessionID: "ses_t",
              structured: true,
              reason: "AMBIGUITY",
              childAssistantTurns: 1,
              continuedSameSession: true,
              upgradedModel: false,
            },
          ],
          outOfScopeMutations: [],
          parentPeakInputTokens: 5000,
          parentTotalTokens: 7000,
          childTotalTokens: 9000,
          frontierTokenShare: 7000 / 16000,
          catalogueCostUnits: 0.03,
          parentFinalText: "done",
          parentFailed: false,
          workspaceFiles: {
            "src/parse-port.ts": must(
              trap.setup["src/parse-port.ts" as keyof typeof trap.setup],
              "src/parse-port.ts",
            ).trimEnd(),
            "src/parse-host.ts": must(
              trap.setup["src/parse-host.ts" as keyof typeof trap.setup],
              "src/parse-host.ts",
            ).trimEnd(),
          },
        },
      }),
    ];

    const passingReport = compareArms({
      baselineRef: "main",
      orchestratorModel: "test/model",
      trialsPerScenario: 1,
      scenarios: subset,
      baselineTrials,
      candidateTrials: candidatePassTrials,
    });

    expect(passingReport.gates.passed).toBe(true);
    expect(passingReport.flips.some((f) => f.direction === "gain")).toBe(true);
    expect(formatComparisonTable(passingReport)).toContain("Release Gates: PASS");

    const regressedTrials = candidatePassTrials.map((trial) =>
      trial.scenarioId === bounded.id ? { ...trial, taskPassed: false } : trial,
    );
    const flips = detectFlips(subset, baselineTrials, regressedTrials);
    expect(
      flips.some(
        (f) =>
          f.scenarioId === bounded.id && f.metric === "taskPassed" && f.direction === "regression",
      ),
    ).toBe(true);

    const failingReport = compareArms({
      baselineRef: "main",
      orchestratorModel: "test/model",
      trialsPerScenario: 1,
      scenarios: subset,
      baselineTrials,
      candidateTrials: regressedTrials,
    });
    expect(failingReport.gates.passed).toBe(false);
    expect(formatComparisonTable(failingReport)).toContain("Release Gates: FAIL");
  });
});
