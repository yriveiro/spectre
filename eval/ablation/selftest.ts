import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { SessionMessageAssistant, SessionMessageAssistantTool } from "@opencode/client";
import type { Transcript } from "../opencode";
import {
  artifactFromVerification,
  type JudgePairResult,
  type JudgeSubmissionArtifact,
  type JudgeTransport,
  judgePairSwapped,
} from "./judge";
import { formatAblationReport } from "./report";
import { type AblationScenario, loadScenario } from "./scenario";
import {
  type AblationSummary,
  summarizeAblation,
  type TrialRecord,
  type ValidityGates,
} from "./score";
import {
  assertExactSkillSet,
  auditStagedPlugin,
  type StagedPluginArm,
  stagePluginArm,
} from "./stage";
import { extractTrajectory } from "./trajectory";
import {
  verifyPristineScenario,
  verifyTrialWorkspace,
  type WorkspaceVerification,
  writeWorkspaceFiles,
} from "./verify";

export interface FaultInjectionCheck {
  readonly id: string;
  readonly caught: boolean;
  readonly detail: string;
}

export interface SelfTestResult {
  readonly passed: boolean;
  readonly summary: AblationSummary;
  readonly faultChecks: ReadonlyArray<FaultInjectionCheck>;
  readonly markdown: string;
}

const makeTool = (input: {
  readonly id: string;
  readonly name: string;
  readonly created: number;
  readonly completed?: number;
  readonly args: Record<string, unknown>;
  readonly text: string;
  readonly metadata?: Record<string, unknown>;
  readonly output?: Record<string, unknown>;
}): SessionMessageAssistantTool =>
  ({
    type: "tool",
    id: input.id,
    name: input.name,
    state: {
      status: "completed",
      input: input.args,
      content: [{ type: "text", text: input.text }],
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
      ...(input.output === undefined ? {} : { output: input.output }),
    },
    time: {
      created: input.created,
      ...(input.completed === undefined ? {} : { completed: input.completed }),
    },
  }) as unknown as SessionMessageAssistantTool;

const makeAssistant = (
  id: string,
  parts: ReadonlyArray<SessionMessageAssistantTool>,
  inputTokens: number,
  usd: number,
): SessionMessageAssistant =>
  ({
    id,
    type: "assistant",
    agent: "spectre",
    model: { providerID: "mock", id: "synthetic-actor" },
    time: { created: 1000, completed: 2000 },
    content: [...parts],
    finish: "stop",
    cost: usd,
    tokens: {
      input: inputTokens,
      output: 240,
      reasoning: 40,
      cache: { read: 300, write: 80 },
    },
  }) as unknown as SessionMessageAssistant;

const makeTddTranscript = (tokens: number): Transcript => ({
  activated: ["tdd"],
  messages: [
    makeAssistant(
      "m-tdd",
      [
        makeTool({
          id: "c1",
          name: "execute",
          created: 100,
          completed: 110,
          args: { code: 'await tools.spectre.skills({ id: "tdd" })' },
          text: '{"status":"inspected","id":"tdd"}',
          metadata: {
            toolCalls: [{ tool: "spectre.skills", status: "completed", input: { id: "tdd" } }],
          },
        }),
        makeTool({
          id: "c2",
          name: "skill",
          created: 120,
          completed: 130,
          args: { id: "tdd" },
          text: "loaded",
        }),
        makeTool({
          id: "c3",
          name: "edit",
          created: 140,
          completed: 150,
          args: { path: "spec/limiter.spec.ts" },
          text: "updated",
        }),
        makeTool({
          id: "c4",
          name: "shell",
          created: 160,
          completed: 190,
          args: { command: "bun run check" },
          text: "4 pass\n1 fail\nExpected: true\nReceived: false\nExit code: 1",
          metadata: { status: "completed", truncated: false, exit: 1 },
        }),
        makeTool({
          id: "c5",
          name: "edit",
          created: 200,
          completed: 210,
          args: { path: "src/limiter.ts" },
          text: "updated",
        }),
        makeTool({
          id: "c6",
          name: "shell",
          created: 220,
          completed: 250,
          args: { command: "bun run check" },
          text: "5 pass\n0 fail",
          output: { exitCode: 0, wallTimeSeconds: 0.04, output: "5 pass\n0 fail" },
          metadata: { status: "completed", truncated: false, exit: 0 },
        }),
      ],
      tokens,
      0,
    ),
  ],
});

const makeEditFirstTranscript = (tokens: number): Transcript => ({
  activated: [],
  messages: [
    makeAssistant(
      "m-stripped",
      [
        makeTool({
          id: "s1",
          name: "edit",
          created: 100,
          completed: 110,
          args: { path: "src/limiter.ts" },
          text: "updated",
        }),
        makeTool({
          id: "s2",
          name: "edit",
          created: 120,
          completed: 130,
          args: { path: "spec/limiter.spec.ts" },
          text: "updated",
        }),
        makeTool({
          id: "s3",
          name: "shell",
          created: 140,
          completed: 170,
          args: { command: "bun run check" },
          text: "5 pass\n0 fail",
          metadata: { status: "completed", truncated: false, exit: 0 },
        }),
      ],
      tokens,
      0,
    ),
  ],
});

const makeScriptedJudgeTransport = (
  winner: "A" | "TIE",
  rationale: string,
): JudgeTransport => async () => ({
  text: JSON.stringify({
    winner,
    scoresA: { boundary_correctness: 5, regression_coverage: 5, minimal_diff: 5 },
    scoresB: {
      boundary_correctness: winner === "TIE" ? 5 : 4,
      regression_coverage: winner === "TIE" ? 5 : 4,
      minimal_diff: winner === "TIE" ? 5 : 4,
    },
    rationale,
  }),
  tokens: { input: 200, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
  hostRecordedUsd: 0,
});

const verifyFixedFixtureWorkspace = async (
  scenario: AblationScenario,
  scratchRoot: string,
): Promise<WorkspaceVerification> => {
  const fixedWorkspace = join(scratchRoot, "fixed-app");
  await mkdir(fixedWorkspace, { recursive: true });
  await writeWorkspaceFiles(fixedWorkspace, scenario.setup);

  const rawLimiter = scenario.setup["src/limiter.ts" as never] as string | undefined;
  const baseSpec = scenario.setup["spec/limiter.spec.ts" as never] as string | undefined;
  if (rawLimiter === undefined || baseSpec === undefined) {
    throw new Error("expected setup files missing from tdd-bugfix scenario");
  }
  const fixedLimiter = rawLimiter.replace("ts >= cutoff", "ts > cutoff");
  const lastClose = baseSpec.lastIndexOf("});");
  const fixedSpec = `${baseSpec.slice(0, lastClose)}
  it("expires a hit at exact nowMs - windowMs", () => {
    const limiter = new SlidingWindowLimiter({ limit: 1, windowMs: 1000 });
    expect(limiter.check("alpha", 1000).allowed).toBe(true);
    expect(limiter.check("alpha", 2000)).toEqual({ allowed: true, remaining: 0, retryAfterMs: 0 });
  });
});
`;
  await Bun.write(join(fixedWorkspace, "src/limiter.ts"), fixedLimiter);
  await Bun.write(join(fixedWorkspace, "spec/limiter.spec.ts"), fixedSpec);
  const verified = await verifyTrialWorkspace({ scenario, workspaceDir: fixedWorkspace });
  if (!verified.passed) {
    throw new Error(`self-test fixed workspace verification failed: ${verified.failureReasons.join("; ")}`);
  }
  return verified;
};

const runFaultInjections = async (input: {
  readonly scenario: AblationScenario;
  readonly strippedStage: StagedPluginArm;
  readonly artifact: JudgeSubmissionArtifact;
  readonly baseTrials: ReadonlyArray<TrialRecord>;
  readonly validity: ValidityGates;
  readonly scratchRoot: string;
}): Promise<{
  readonly faultChecks: ReadonlyArray<FaultInjectionCheck>;
  readonly disagreedJudge: JudgePairResult;
}> => {
  const faultChecks: Array<FaultInjectionCheck> = [];

  const extraIdCheck = assertExactSkillSet(
    [...input.strippedStage.expectedIds, "tdd"],
    input.strippedStage.expectedIds,
    "fault-extra-id",
  );
  faultChecks.push({
    id: "extra_registered_id_caught",
    caught: !extraIdCheck.ok && extraIdCheck.extra.includes("tdd"),
    detail: extraIdCheck.findings.join("; "),
  });

  const playbookPath = join(input.strippedStage.pluginDir, "skills/definitions/playbook/SKILL.md");
  const origPlaybook = await Bun.file(playbookPath).text();
  await Bun.write(playbookPath, `${origPlaybook}\nUse \`tdd\` before editing.\n`);
  const leakedAudit = await auditStagedPlugin(input.strippedStage);
  await Bun.write(playbookPath, origPlaybook);
  faultChecks.push({
    id: "surviving_tdd_cue_caught",
    caught: !leakedAudit.ok && leakedAudit.leaks.length > 0,
    detail: leakedAudit.findings.join("; "),
  });

  const syntaxFalseRed = extractTrajectory({
    scenario: input.scenario,
    parent: {
      activated: ["tdd"],
      messages: [
        makeAssistant(
          "m-syntax",
          [
            makeTool({
              id: "x1",
              name: "edit",
              created: 100,
              completed: 110,
              args: { path: "spec/limiter.spec.ts" },
              text: "ok",
            }),
            makeTool({
              id: "x2",
              name: "shell",
              created: 120,
              completed: 140,
              args: { command: "bun test" },
              text: "SyntaxError: Unexpected token at spec/limiter.spec.ts:10",
              metadata: { status: "completed", exit: 1 },
            }),
            makeTool({
              id: "x3",
              name: "edit",
              created: 150,
              completed: 160,
              args: { path: "src/limiter.ts" },
              text: "ok",
            }),
            makeTool({
              id: "x4",
              name: "shell",
              created: 170,
              completed: 190,
              args: { command: "bun test" },
              text: "5 pass\n0 fail",
              metadata: { status: "completed", exit: 0 },
            }),
          ],
          900,
          0,
        ),
      ],
    },
    children: new Map(),
  });
  const editBeforeTest = extractTrajectory({
    scenario: input.scenario,
    parent: makeEditFirstTranscript(900),
    children: new Map(),
  });
  faultChecks.push({
    id: "false_red_witness_caught",
    caught:
      !syntaxFalseRed.trajectory.causalRedBeforeEdit &&
      syntaxFalseRed.trajectory.redWitnessRejectionReasons.includes(
        "red_test_was_syntax_or_setup_error",
      ) &&
      !editBeforeTest.trajectory.causalRedBeforeEdit &&
      editBeforeTest.trajectory.redWitnessRejectionReasons.includes("prod_edit_before_red_test"),
    detail: `syntax=${syntaxFalseRed.trajectory.redWitnessRejectionReasons.join(",")}; editFirst=${editBeforeTest.trajectory.redWitnessRejectionReasons.join(",")}`,
  });

  const disagreedJudge = await judgePairSwapped({
    scenario: input.scenario,
    left: input.artifact,
    right: input.artifact,
    transport: makeScriptedJudgeTransport("A", "always picks slot A"),
    forbiddenTokens: [input.scratchRoot],
  });
  faultChecks.push({
    id: "order_disagreement_caught",
    caught: disagreedJudge.outcome === "unresolved",
    detail: `outcome=${disagreedJudge.outcome}`,
  });

  const incompleteSummary = summarizeAblation({
    scenarioId: input.scenario.id,
    targetSkill: input.scenario.targetSkill,
    trialsPerArm: 5,
    trials: [
      ...input.baseTrials,
      {
        ...input.baseTrials[0]!,
        trialIndex: 4,
        completion: { status: "timed_out", reason: "injected actor timeout" },
      },
    ],
    validity: input.validity,
  });
  faultChecks.push({
    id: "incomplete_timed_out_trial_caught",
    caught:
      incompleteSummary.verdict === "inconclusive" &&
      incompleteSummary.verdictReasons.includes("incomplete_trials"),
    detail: `verdict=${incompleteSummary.verdict} (${incompleteSummary.verdictReasons.join(",")})`,
  });

  return { faultChecks, disagreedJudge };
};

export const runSelfTest = async (options?: {
  readonly trials?: number;
}): Promise<SelfTestResult> => {
  const trialsPerArm = options?.trials ?? 2;
  const scenario = await loadScenario(`${import.meta.dir}/scenarios/tdd-bugfix.json`);
  const scratchRoot = join(
    Bun.env.TMPDIR ?? "/tmp",
    `spectre-selftest-${crypto.randomUUID().slice(0, 8)}`,
  );
  await mkdir(scratchRoot, { recursive: true });

  try {
    const pristine = await verifyPristineScenario(scenario);
    if (!pristine.ok) {
      throw new Error(`pristine scenario verification failed: ${pristine.findings.join("; ")}`);
    }

    const presentStage = await stagePluginArm({
      baseDir: scratchRoot,
      arm: "present",
      targetSkill: scenario.targetSkill,
    });
    const strippedStage = await stagePluginArm({
      baseDir: scratchRoot,
      arm: "stripped",
      targetSkill: scenario.targetSkill,
    });

    const presentAudit = await auditStagedPlugin(presentStage);
    const strippedAudit = await auditStagedPlugin(strippedStage);
    const stagedAuditPassed = presentAudit.ok && strippedAudit.ok;

    const workspaceVerification = await verifyFixedFixtureWorkspace(scenario, scratchRoot);
    const artifact = artifactFromVerification(workspaceVerification);

    const trials: Array<TrialRecord> = [];
    for (let i = 0; i < trialsPerArm; i++) {
      const presentExt = extractTrajectory({
        scenario,
        parent: makeTddTranscript(1200 + i * 35),
        children: new Map(),
      });
      const strippedExt = extractTrajectory({
        scenario,
        parent: makeEditFirstTranscript(1050 + i * 25),
        children: new Map(),
      });
      const replicateExt = extractTrajectory({
        scenario,
        parent: makeTddTranscript(1240 + i * 40),
        children: new Map(),
      });
      trials.push(
        {
          trialIndex: i,
          arm: "present",
          scenarioId: scenario.id,
          completion: { status: "completed" },
          registrationVerified: true,
          activation: presentExt.activation,
          trajectory: presentExt.trajectory,
          workspace: workspaceVerification,
          cost: presentExt.cost,
          durationMs: 100,
        },
        {
          trialIndex: i,
          arm: "stripped",
          scenarioId: scenario.id,
          completion: { status: "completed" },
          registrationVerified: true,
          activation: strippedExt.activation,
          trajectory: strippedExt.trajectory,
          workspace: workspaceVerification,
          cost: strippedExt.cost,
          durationMs: 90,
        },
        {
          trialIndex: i,
          arm: "replicate",
          scenarioId: scenario.id,
          completion: { status: "completed" },
          registrationVerified: true,
          activation: replicateExt.activation,
          trajectory: replicateExt.trajectory,
          workspace: workspaceVerification,
          cost: replicateExt.cost,
          durationMs: 105,
        },
      );
    }

    const validity: ValidityGates = {
      stagedAuditPassed,
      hostRegistrationVerified: true,
      blindingVerified: true,
      crossFamilyJudgeVerified: true,
      zeroSystemicFailures: true,
      allPassed: stagedAuditPassed,
    };

    const { faultChecks, disagreedJudge } = await runFaultInjections({
      scenario,
      strippedStage,
      artifact,
      baseTrials: trials,
      validity,
      scratchRoot,
    });

    const judgeAB = [
      await judgePairSwapped({
        scenario,
        left: artifact,
        right: artifact,
        transport: makeScriptedJudgeTransport("TIE", "equivalent diffs"),
        forbiddenTokens: [scratchRoot],
      }),
    ];

    const summary = summarizeAblation({
      scenarioId: scenario.id,
      targetSkill: scenario.targetSkill,
      trialsPerArm,
      trials,
      judgeAB,
      judgeAA: [disagreedJudge],
      validity,
    });

    const faultLines = [
      "",
      "## Self-Test Fault-Injection Checks",
      ...faultChecks.map(
        (check) => `- [${check.caught ? "PASS" : "FAIL"}] ${check.id}: ${check.detail}`,
      ),
    ];

    const markdown = `${formatAblationReport(summary, {
      mode: "self-test",
      actorModel: "synthetic/self-test-actor",
      actorFamily: "synthetic-a",
      judgeModel: "synthetic/self-test-judge",
      judgeFamily: "synthetic-b",
    }).trimEnd()}\n${faultLines.join("\n")}\n`;

    return {
      passed: stagedAuditPassed && faultChecks.every((check) => check.caught),
      summary,
      faultChecks,
      markdown,
    };
  } finally {
    await rm(scratchRoot, { recursive: true, force: true });
  }
};
