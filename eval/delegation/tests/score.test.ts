import { describe, expect, test } from "bun:test";
import type { SessionMessageAssistant } from "@opencode/client";
import type { Transcript } from "../../opencode";
import { REPO } from "../../resume/docker";
import { materializeBaselinePlugin, resolveConfigOverride } from "../ab";
import { estimateProxyCost, isModelUpgrade, observeRun, observeTranscript } from "../observe";
import {
  type DelegationScenario,
  listScenarios,
  parseScenario,
  selectScenarios,
} from "../scenario";
import {
  compareArms,
  delegatedCorrectly,
  detectFlips,
  escalatedCleanly,
  evaluateTaskPassed,
  formatComparisonTable,
  scoreTrial,
  wilsonInterval,
} from "../score";

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
  test("loads all 8 scenarios across all 3 slices and covers all 3 escalation reasons without prompt spoilers", async () => {
    const scenarios = await listScenarios();
    expect(scenarios.length).toBe(8);

    const bySlice = new Map<string, number>();
    const reasons = new Set<string>();
    for (const scenario of scenarios) {
      bySlice.set(scenario.slice, (bySlice.get(scenario.slice) ?? 0) + 1);
      if (scenario.expect.escalation !== undefined) {
        reasons.add(scenario.expect.escalation.reason);
      }
      for (const turn of scenario.turns) {
        expect(turn.prompt).not.toMatch(/delegate to `?operator`?/i);
        expect(turn.prompt).not.toMatch(/same child session/i);
        expect(turn.prompt).not.toMatch(/if the worker escalates/i);
      }
    }

    expect(bySlice.get("bounded-delegate")).toBe(2);
    expect(bySlice.get("worker-escalate")).toBe(3);
    expect(bySlice.get("inline-negative")).toBe(3);
    expect([...reasons].toSorted()).toEqual(["AMBIGUITY", "FAILURE_CAP", "SCOPE"]);
  });

  test("trap scenario verifyCommands fail on unimplemented setup workspaces", async () => {
    const traps = await selectScenarios([
      "trap-ambiguity-contract",
      "trap-scope-boundary",
      "trap-failure-cap",
    ]);
    const scratchRoot = `${Bun.env.TMPDIR ?? "/tmp"}/spectre-trap-verify-${process.pid}-${Date.now()}`;
    try {
      for (const scenario of traps) {
        const dir = `${scratchRoot}/${scenario.id}`;
        await Bun.$`mkdir -p ${dir}`.quiet();
        for (const [rel, content] of Object.entries(scenario.setup)) {
          await Bun.write(`${dir}/${rel}`, content);
        }
        const cmd = must(scenario.verifyCommand, `${scenario.id}.verifyCommand`);
        const proc = Bun.spawn(["sh", "-c", cmd], {
          cwd: dir,
          stdout: "ignore",
          stderr: "ignore",
        });
        expect(await proc.exited).not.toBe(0);
      }
    } finally {
      await Bun.$`rm -rf ${scratchRoot}`.quiet();
    }
  });

  test("inline-framing-vague rejects nonsense replies and fabricated workspace files", async () => {
    const vague = must(
      (await selectScenarios(["inline-framing-vague"]))[0],
      "inline-framing-vague",
    );
    const baseObserved = {
      scenarioId: vague.id,
      loadedModelRouter: false,
      routingCalls: 0,
      subagentCalls: [],
      operatorSpawns: 0,
      escalations: [],
      outOfScopeMutations: [],
      unexpectedFileMutations: [],
      verifiedAfterLastEdit: true,
      parentPeakInputTokens: 1000,
      parentTotalTokens: 1200,
      childTotalTokens: 0,
      frontierTokenShare: 1,
      catalogueCostUnits: 0.01,
      parentFinalText:
        "Only README.md exists so far — which service bottleneck or files should we target?",
      parentFailed: false,
      workspaceFiles: { "README.md": "# Service\nMinimal worker service." },
    };

    expect(evaluateTaskPassed(vague, baseObserved)).toBe(true);
    expect(evaluateTaskPassed(vague, { ...baseObserved, parentFinalText: "ok done" })).toBe(false);
    expect(
      evaluateTaskPassed(vague, {
        ...baseObserved,
        unexpectedFileMutations: ["src/fabricated.ts"],
      }),
    ).toBe(false);
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
  test("computes pre-escalation turnsAtStop and allows post-escalation scope widening on trap-scope-boundary", async () => {
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
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    status: "resolved",
                    profiles: [
                      {
                        name: "worker",
                        agent: "operator",
                        effort: "medium",
                        model: { ref: "opencode-go/minimax-m3.1-flash-free" },
                      },
                    ],
                  }),
                },
              ],
            }),
            toolPart({
              name: "subagent",
              created: 2,
              args: {
                agent: "operator",
                model: "opencode-go/minimax-m3.1-flash-free",
                description: "Update parser",
                prompt: "Scope: src/lexer.ts, src/parser.ts, test/parser.test.ts",
              },
              metadata: { sessionID: "ses_child_1" },
              content: [
                {
                  type: "text",
                  text: `<background-result kind="subagent" sessionID="ses_child_1" state="completed" description="Update parser">\nSTATUS: ESCALATE\nREASON: SCOPE\nBLOCKER: src/public.ts needs ParseResult union\nOPTIONS_OR_ATTEMPTS: Cannot edit src/public.ts under brief scope\nTOUCHED: none\nRECOMMENDED_NEXT: orchestrator_decision\n</background-result>`,
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
              created: 5,
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
                  text: `<background-result kind="subagent" sessionID="ses_child_1" state="completed" description="Widen scope">\nSTATUS: DONE\nTOUCHED: src/public.ts, src/parser.ts\nVERIFIED: bun test\nOUTCOME: Updated ParseResult\n</background-result>`,
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
              [
                toolPart({
                  name: "edit",
                  created: 6,
                  args: { path: "src/public.ts" },
                }),
                toolPart({
                  name: "shell",
                  created: 7,
                  args: { command: "bun test" },
                }),
                textPart("STATUS: DONE\nTOUCHED: src/public.ts\nVERIFIED: bun test\nOUTCOME: ok"),
              ],
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
        "src/public.ts":
          "export type ParseResult = { readonly ok: true; readonly value: string } | { readonly ok: false; readonly error: string };",
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
        childAssistantTurns: 1,
        continuedSameSession: true,
        upgradedModel: false,
        switchedModel: false,
      },
    ]);
    expect(observed.outOfScopeMutations).toEqual([]);
    expect(observed.unexpectedFileMutations).toEqual([]);
    expect(observed.verifiedAfterLastEdit).toBe(true);
    expect(observed.parentPeakInputTokens).toBe(5000);
    expect(observed.parentTotalTokens).toBe(9600);
    expect(observed.childTotalTokens).toBe(5000);
    expect(observed.frontierTokenShare).toBeCloseTo(9600 / 14600, 5);
    expect(observed.catalogueCostUnits).toBeCloseTo(0.05, 5);

    const scored = scoreTrial({
      scenario,
      arm: "candidate",
      trial: 1,
      observed,
      verifyExitCode: 0,
    });
    expect(scored.taskPassed).toBe(true);
    expect(escalatedCleanly(scenario, scored)).toBe(true);

    const dirtyBeforeEscalation = new Map<string, Transcript>([
      [
        "ses_child_1",
        {
          activated: [],
          messages: [
            msg([
              toolPart({
                name: "edit",
                created: 3,
                args: { path: "/workspace/src/public.ts" },
              }),
              textPart(
                "STATUS: ESCALATE\nREASON: SCOPE\nBLOCKER: src/public.ts\nOPTIONS_OR_ATTEMPTS: edited first\nTOUCHED: src/public.ts\nRECOMMENDED_NEXT: orchestrator_decision",
              ),
            ]),
          ],
        },
      ],
    ]);

    const dirtyObserved = observeTranscript({
      scenario,
      parent,
      children: dirtyBeforeEscalation,
      workspaceFiles: {},
    });
    expect(dirtyObserved.outOfScopeMutations).toEqual(["src/public.ts"]);
  });

  test("distinguishes model upgrades from omitted-model fills and downgrades, and computes proxy cost when provider cost is 0", async () => {
    const scenario = must((await selectScenarios(["trap-failure-cap"]))[0], "trap-failure-cap");

    expect(
      isModelUpgrade(undefined, "opencode-go/minimax-m3.1-flash-free", scenario.spectreConfig),
    ).toBe(false);
    expect(
      isModelUpgrade(
        "opencode-go/kimi-k3",
        "opencode-go/minimax-m3.1-flash-free",
        scenario.spectreConfig,
      ),
    ).toBe(false);
    expect(
      isModelUpgrade(
        "opencode-go/minimax-m3.1-flash-free#high",
        "opencode-go/minimax-m3.1-flash-free#low",
        scenario.spectreConfig,
      ),
    ).toBe(false);
    expect(
      isModelUpgrade(
        "opencode-go/minimax-m3.1-flash-free",
        "opencode-go/kimi-k3",
        scenario.spectreConfig,
      ),
    ).toBe(true);
    expect(
      isModelUpgrade(
        "opencode-go/minimax-m3.1-flash-free#medium",
        "opencode-go/minimax-m3.1-flash-free#high",
        scenario.spectreConfig,
      ),
    ).toBe(true);

    expect(
      estimateProxyCost(
        {
          input: 10000,
          output: 2000,
          reasoning: 0,
          cacheRead: 0,
          cacheWrite: 0,
          total: 12000,
          cost: 0,
        },
        1,
      ),
    ).toBeCloseTo(0.02, 8);

    const parent: Transcript = {
      activated: ["model-router"],
      messages: [
        msg(
          [
            toolPart({
              name: "spectre.routing",
              created: 1,
              args: {},
            }),
            toolPart({
              name: "subagent",
              created: 2,
              args: {
                agent: "operator",
                model: "opencode-go/minimax-m3.1-flash-free",
              },
              metadata: { sessionID: "ses_fc" },
              content: [
                {
                  type: "text",
                  text: `<background-result kind="subagent" sessionID="ses_fc">\nSTATUS: ESCALATE\nREASON: FAILURE_CAP\nBLOCKER: cycle\nOPTIONS_OR_ATTEMPTS: 2 attempts\nTOUCHED: src/dag.ts\nRECOMMENDED_NEXT: higher_profile\n</background-result>`,
                },
              ],
            }),
            toolPart({
              name: "subagent",
              created: 4,
              args: {
                agent: "operator",
                sessionID: "ses_fc",
                model: "opencode-go/kimi-k3",
              },
              metadata: { sessionID: "ses_fc" },
            }),
          ],
          { input: 10000, output: 1000 },
          0,
        ),
      ],
    };

    const children = new Map<string, Transcript>([
      [
        "ses_fc",
        {
          activated: [],
          messages: [
            msg(
              [
                toolPart({ name: "edit", created: 2, args: { path: "src/dag.ts" } }),
                toolPart({ name: "shell", created: 3, args: { command: "bun test" } }),
                toolPart({ name: "edit", created: 5, args: { path: "src/topo.ts" } }),
              ],
              { input: 8000, output: 1000 },
              0,
            ),
          ],
        },
      ],
    ]);

    const observed = observeTranscript({
      scenario,
      parent,
      children,
      workspaceFiles: {},
    });

    expect(observed.catalogueCostUnits).toBeGreaterThan(0);
    expect(observed.verifiedAfterLastEdit).toBe(false);
    expect(observed.escalations[0]?.upgradedModel).toBe(true);
  });

  test("observeRun snapshots full workspace to report unexpectedFileMutations and deleted setup files", async () => {
    const scenario = must(
      (await selectScenarios(["inline-single-file-why"]))[0],
      "inline-single-file-why",
    );
    const ws = `${Bun.env.TMPDIR ?? "/tmp"}/spectre-observe-ws-${process.pid}-${Date.now()}`;
    await Bun.$`mkdir -p ${ws}/src`.quiet();
    try {
      await Bun.write(`${ws}/spectre.json`, "{}\n");
      await Bun.write(`${ws}/src/rogue.ts`, "export const rogue = 1;\n");

      const obs = await observeRun({
        scenario,
        workspace: ws,
        parent: { activated: [], messages: [msg([textPart("poisoning")])] },
        children: new Map(),
      });

      expect(obs.unexpectedFileMutations).toEqual(["src/cache.ts", "src/rogue.ts"]);
    } finally {
      await Bun.$`rm -rf ${ws}`.quiet();
    }
  });
});

describe("eval/delegation/score & ab", () => {
  test("enforces loadedModelRouter, routingCalls >= 1, and allowedProfiles in delegatedCorrectly", async () => {
    const scenario = must((await selectScenarios(["bounded-log-triage"]))[0], "bounded-log-triage");

    const makeTrial = (overrides: Partial<Parameters<typeof scoreTrial>[0]["observed"]>) =>
      scoreTrial({
        scenario,
        arm: "candidate",
        trial: 1,
        observed: {
          scenarioId: scenario.id,
          loadedModelRouter: true,
          routingCalls: 1,
          routedProfiles: [
            {
              profile: "mechanical",
              agent: "operator",
              modelRef: "opencode-go/minimax-m3.1-flash-free#low",
            },
            {
              profile: "worker",
              agent: "operator",
              modelRef: "opencode-go/minimax-m3.1-flash-free#medium",
            },
          ],
          subagentCalls: [
            {
              agent: "operator",
              model: "opencode-go/minimax-m3.1-flash-free#low",
              hasInputSessionID: false,
              outputSessionID: "ses_1",
              switchedModelOnResume: false,
              outputText: "",
            },
          ],
          operatorSpawns: 1,
          escalations: [],
          outOfScopeMutations: [],
          unexpectedFileMutations: [],
          verifiedAfterLastEdit: true,
          parentPeakInputTokens: 2000,
          parentTotalTokens: 2500,
          childTotalTokens: 3000,
          frontierTokenShare: 2500 / 5500,
          catalogueCostUnits: 0.01,
          parentFinalText: "token-expiry.test.ts invoice-rounding.test.ts",
          parentFailed: false,
          workspaceFiles: {},
          ...overrides,
        },
      });

    expect(delegatedCorrectly(scenario, makeTrial({}))).toBe(true);
    expect(delegatedCorrectly(scenario, makeTrial({ loadedModelRouter: false }))).toBe(false);
    expect(delegatedCorrectly(scenario, makeTrial({ routingCalls: 0 }))).toBe(false);
    expect(
      delegatedCorrectly(
        scenario,
        makeTrial({
          subagentCalls: [
            {
              agent: "operator",
              model: "opencode-go/minimax-m3.1-flash-free#medium",
              hasInputSessionID: false,
              outputSessionID: "ses_1",
              switchedModelOnResume: false,
              outputText: "",
            },
          ],
        }),
      ),
    ).toBe(false);
  });

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
            model: "opencode-go/minimax-m3.1-flash-free",
            hasInputSessionID: false,
            outputSessionID: "ses_1",
            switchedModelOnResume: false,
            outputText: "",
          },
        ],
        operatorSpawns: 1,
        escalations: [],
        outOfScopeMutations: [],
        unexpectedFileMutations: [],
        verifiedAfterLastEdit: true,
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

  test("detects scenario flips, evaluates release gates, and formats Wilson 95% CIs when trials > 1", async () => {
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
    const expectedBoundedFiles = Object.fromEntries(
      Object.entries(bounded.expect.expectedFiles ?? {}).map(([k, v]) => [k, v.trimEnd()]),
    );

    const fixtureCalls = (id: string, active: boolean, trapReason?: "AMBIGUITY") =>
      !active
        ? []
        : [
            {
              agent: "operator",
              model: "opencode-go/minimax-m3.1-flash-free",
              hasInputSessionID: false,
              outputSessionID: `ses_${id}`,
              switchedModelOnResume: false,
              outputText: "",
            },
            ...(trapReason === undefined
              ? []
              : [
                  {
                    agent: "operator",
                    hasInputSessionID: true,
                    inputSessionID: `ses_${id}`,
                    outputSessionID: `ses_${id}`,
                    switchedModelOnResume: false,
                    outputText: "",
                  },
                ]),
          ];

    const scoreFixture = (input: {
      scenario: DelegationScenario;
      arm: "baseline" | "candidate";
      trial: number;
      baseCost: number;
      candCost: number;
      baseIn: number;
      candIn: number;
      childTok: number;
      text: string;
      files: Readonly<Record<string, string>>;
      delegates: boolean;
      trapReason?: "AMBIGUITY";
    }) => {
      const active = input.arm === "candidate" && input.delegates;
      const peak = input.arm === "candidate" ? input.candIn : input.baseIn;
      const parentTok = Math.round(peak * 1.25);
      const childTotal = active ? input.childTok : 0;
      return scoreTrial({
        scenario: input.scenario,
        arm: input.arm,
        trial: input.trial,
        ...(input.delegates ? { verifyExitCode: 0 } : {}),
        ...(input.arm === "candidate" ? { baselineCostUnits: input.baseCost } : {}),
        observed: {
          scenarioId: input.scenario.id,
          loadedModelRouter: active,
          routingCalls: active ? 1 : 0,
          subagentCalls: fixtureCalls(input.scenario.id, active, input.trapReason),
          operatorSpawns: active ? 1 : 0,
          escalations:
            active && input.trapReason !== undefined
              ? [
                  {
                    childSessionID: `ses_${input.scenario.id}`,
                    structured: true,
                    reason: input.trapReason,
                    childAssistantTurns: 1,
                    continuedSameSession: true,
                    upgradedModel: false,
                    switchedModel: false,
                  },
                ]
              : [],
          outOfScopeMutations: [],
          unexpectedFileMutations: [],
          verifiedAfterLastEdit: true,
          parentPeakInputTokens: peak,
          parentTotalTokens: parentTok,
          childTotalTokens: childTotal,
          frontierTokenShare: parentTok / (parentTok + childTotal),
          catalogueCostUnits: input.arm === "candidate" ? input.candCost : input.baseCost,
          parentFinalText: input.text,
          parentFailed: false,
          workspaceFiles: input.files,
        },
      });
    };

    const makeTrialSet = (arm: "baseline" | "candidate", trial: number) => [
      scoreFixture({
        scenario: bounded,
        arm,
        trial,
        baseCost: 0.1,
        candCost: 0.03,
        baseIn: 20000,
        candIn: 6000,
        childTok: 12000,
        text: "done",
        files: expectedBoundedFiles,
        delegates: true,
      }),
      scoreFixture({
        scenario: inline,
        arm,
        trial,
        baseCost: 0.02,
        candCost: 0.02,
        baseIn: 4000,
        candIn: 4000,
        childTok: 0,
        text: "to avoid poisoning the cache",
        files: {},
        delegates: false,
      }),
      scoreFixture({
        scenario: trap,
        arm,
        trial,
        baseCost: 0.08,
        candCost: 0.03,
        baseIn: 12000,
        candIn: 5000,
        childTok: 9000,
        text: "done",
        files: {},
        delegates: true,
        trapReason: "AMBIGUITY",
      }),
    ];

    const baselineTrials = [...makeTrialSet("baseline", 1), ...makeTrialSet("baseline", 2)];
    const candidatePassTrials = [...makeTrialSet("candidate", 1), ...makeTrialSet("candidate", 2)];

    const passingReport = compareArms({
      baselineRef: "main",
      orchestratorModel: "test/model",
      trialsPerScenario: 2,
      scenarios: subset,
      baselineTrials,
      candidateTrials: candidatePassTrials,
    });

    expect(passingReport.gates.passed).toBe(true);
    expect(passingReport.flips.some((f) => f.direction === "gain")).toBe(true);
    const rendered = formatComparisonTable(passingReport);
    expect(rendered).toContain("Release Gates: PASS");
    expect(rendered).toContain("Pass-Rate Summary (Wilson 95% CI):");
    expect(rendered).toContain("95% CI [");

    const ci = wilsonInterval(5, 10);
    expect(ci.low).toBeGreaterThan(0.2);
    expect(ci.high).toBeLessThan(0.8);

    const regressedTrials = candidatePassTrials.map((trial) =>
      trial.scenarioId === bounded.id && trial.trial === 1
        ? { ...trial, taskPassed: false }
        : trial,
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
      trialsPerScenario: 2,
      scenarios: subset,
      baselineTrials,
      candidateTrials: regressedTrials,
    });
    expect(failingReport.gates.passed).toBe(false);
    expect(formatComparisonTable(failingReport)).toContain("Release Gates: FAIL");
  });

  test("materializeBaselinePlugin filters archive to publish allowlist and resolveConfigOverride defaults to undefined", async () => {
    expect(await resolveConfigOverride({})).toBeUndefined();

    const targetDir = `${Bun.env.TMPDIR ?? "/tmp"}/spectre-baseline-pkg-${process.pid}-${Date.now()}`;
    try {
      const pluginDir = await materializeBaselinePlugin("HEAD", targetDir);
      expect(await Bun.file(`${pluginDir}/index.ts`).exists()).toBe(true);
      expect(await Bun.file(`${pluginDir}/package.json`).exists()).toBe(true);
      expect(await Bun.file(`${pluginDir}/AGENTS.md`).exists()).toBe(false);
      const hasEval = await Bun.file(`${pluginDir}/eval`)
        .stat()
        .then(
          () => true,
          () => false,
        );
      expect(hasEval).toBe(false);
    } finally {
      await Bun.$`rm -rf ${targetDir}`.quiet();
    }
  });

  test("run.ts exits 1 with usage when neither --live nor --self-test is passed", async () => {
    const proc = Bun.spawn(["bun", "run", "eval/delegation/run.ts"], {
      cwd: REPO,
      stdout: "pipe",
      stderr: "pipe",
    });
    const code = await proc.exited;
    const stderr = await new Response(proc.stderr).text();
    expect(code).toBe(1);
    expect(stderr).toContain("--live");
    expect(stderr).toContain("--self-test");
  });
});
