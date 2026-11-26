import { describe, expect, test } from "bun:test";
import {
  buildTrialSchedule,
  summarizeAblation,
  type TrialCompletionStatus,
  type TrialRecord,
  type ValidityGates,
} from "../score";
import type { AblationArm } from "../stage";

const passingGates: ValidityGates = {
  stagedAuditPassed: true,
  hostRegistrationVerified: true,
  blindingVerified: true,
  crossFamilyJudgeVerified: true,
  zeroSystemicFailures: true,
  allPassed: true,
};

const makeTrial = (input: {
  readonly trialIndex: number;
  readonly arm: AblationArm;
  readonly loaded?: boolean;
  readonly causalRed?: boolean;
  readonly workspacePassed?: boolean;
  readonly status?: TrialCompletionStatus;
  readonly tokens?: number;
  readonly usd?: number;
}): TrialRecord => ({
  trialIndex: input.trialIndex,
  arm: input.arm,
  scenarioId: "tdd-bugfix",
  completion: {
    status: input.status ?? "completed",
    ...(input.status && input.status !== "completed" ? { reason: input.status } : {}),
  },
  registrationVerified: true,
  activation: {
    targetSkillLoaded: input.loaded ?? input.arm !== "stripped",
    activatedSkills: (input.loaded ?? input.arm !== "stripped") ? ["tdd"] : [],
    failedSkillCalls: [],
  },
  trajectory: {
    causalRedBeforeEdit: input.causalRed ?? input.arm !== "stripped",
    testEditedBeforeRedRun: input.causalRed ?? input.arm !== "stripped",
    redRunCompletedBeforeProdEdit: input.causalRed ?? input.arm !== "stripped",
    greenRunAfterLastProdEdit: true,
    redWitnessRejectionReasons:
      (input.causalRed ?? input.arm !== "stripped") ? [] : ["prod_edit_before_red_test"],
    toolCalls: 6,
    toolErrors: 0,
    assistantTurns: 4,
    codemodeCalls: [],
    events: [],
  },
  workspace: {
    passed: input.workspacePassed ?? true,
    actorSuitePassed: input.workspacePassed ?? true,
    trustedOraclePassed: input.workspacePassed ?? true,
    actorSpecFailsPreFix: input.workspacePassed ?? true,
    allowedMutationsOnly: true,
    unexpectedFiles: [],
    verifyTimedOut: false,
    actorSuiteExitCode: 0,
    oracleExitCode: 0,
    preFixSpecExitCode: 1,
    actorSuiteOutput: "",
    oracleOutput: "",
    preFixSpecOutput: "",
    diffs: [],
    failureReasons: [],
  },
  cost: {
    usage: {
      input: input.tokens ?? 1000,
      output: 200,
      reasoning: 0,
      cacheRead: 300,
      cacheWrite: 100,
      total: (input.tokens ?? 1000) + 600,
      cost: input.usd ?? 0,
    },
    hostRecordedUsd: input.usd ?? 0,
  },
  durationMs: 1200,
});

describe("balanced trial rotation and descriptive ablation scoring", () => {
  test("rotates arm order evenly across 3-trial and 6-trial schedules", () => {
    const schedule = buildTrialSchedule(6);
    expect(schedule.length).toBe(18);
    const firstSlots = [0, 1, 2, 3, 4, 5].map((block) => schedule[block * 3]!.arm);
    expect(firstSlots.filter((arm) => arm === "present").length).toBe(2);
    expect(firstSlots.filter((arm) => arm === "stripped").length).toBe(2);
    expect(firstSlots.filter((arm) => arm === "replicate").length).toBe(2);

    let presentBeforeStripped = 0;
    let strippedBeforePresent = 0;
    for (let block = 0; block < 6; block++) {
      const arms = schedule.slice(block * 3, block * 3 + 3).map((entry) => entry.arm);
      if (arms.indexOf("present") < arms.indexOf("stripped")) presentBeforeStripped++;
      else strippedBeforePresent++;
    }
    expect(presentBeforeStripped).toBe(3);
    expect(strippedBeforePresent).toBe(3);
  });

  test("returns inconclusive on small samples, incomplete/timed-out trials, and unexposed treatment", () => {
    const smallTrials: Array<TrialRecord> = [];
    for (let i = 0; i < 2; i++) {
      smallTrials.push(makeTrial({ trialIndex: i, arm: "present" }));
      smallTrials.push(makeTrial({ trialIndex: i, arm: "stripped", causalRed: false }));
      smallTrials.push(makeTrial({ trialIndex: i, arm: "replicate" }));
    }
    const small = summarizeAblation({
      scenarioId: "tdd-bugfix",
      targetSkill: "tdd",
      trialsPerArm: 2,
      trials: smallTrials,
      validity: passingGates,
    });
    expect(small.verdict).toBe("inconclusive");
    expect(small.verdictReasons).toContain("small_sample");

    const timedOutTrials: Array<TrialRecord> = [];
    for (let i = 0; i < 5; i++) {
      timedOutTrials.push(
        makeTrial({
          trialIndex: i,
          arm: "present",
          status: i === 4 ? "timed_out" : "completed",
        }),
      );
      timedOutTrials.push(makeTrial({ trialIndex: i, arm: "stripped", causalRed: false }));
      timedOutTrials.push(makeTrial({ trialIndex: i, arm: "replicate" }));
    }
    const timedOut = summarizeAblation({
      scenarioId: "tdd-bugfix",
      targetSkill: "tdd",
      trialsPerArm: 5,
      trials: timedOutTrials,
      validity: passingGates,
    });
    expect(timedOut.verdict).toBe("inconclusive");
    expect(timedOut.verdictReasons).toContain("incomplete_trials");

    const unexposedTrials: Array<TrialRecord> = [];
    for (let i = 0; i < 5; i++) {
      unexposedTrials.push(makeTrial({ trialIndex: i, arm: "present", loaded: false }));
      unexposedTrials.push(makeTrial({ trialIndex: i, arm: "stripped", causalRed: false }));
      unexposedTrials.push(makeTrial({ trialIndex: i, arm: "replicate" }));
    }
    const unexposed = summarizeAblation({
      scenarioId: "tdd-bugfix",
      targetSkill: "tdd",
      trialsPerArm: 5,
      trials: unexposedTrials,
      validity: passingGates,
    });
    expect(unexposed.verdict).toBe("inconclusive");
    expect(unexposed.verdictReasons).toContain("unexposed_treatment");
  });

  test("keeps workspace pass, activation, trajectory, and host-recorded USD separate and emits positive_signal when complete pairs exceed A/A spread", () => {
    const trials: Array<TrialRecord> = [];
    for (let i = 0; i < 5; i++) {
      trials.push(
        makeTrial({
          trialIndex: i,
          arm: "present",
          loaded: true,
          causalRed: true,
          workspacePassed: true,
          tokens: 1000,
          usd: 0,
        }),
      );
      trials.push(
        makeTrial({
          trialIndex: i,
          arm: "stripped",
          loaded: false,
          causalRed: false,
          workspacePassed: true,
          tokens: 900,
          usd: 0,
        }),
      );
      trials.push(
        makeTrial({
          trialIndex: i,
          arm: "replicate",
          loaded: true,
          causalRed: true,
          workspacePassed: true,
          tokens: 1050,
          usd: 0,
        }),
      );
    }

    const summary = summarizeAblation({
      scenarioId: "tdd-bugfix",
      targetSkill: "tdd",
      trialsPerArm: 5,
      trials,
      validity: passingGates,
    });

    expect(summary.verdict).toBe("positive_signal");
    expect(summary.arms.present.workspacePassCount).toBe(5);
    expect(summary.arms.stripped.workspacePassCount).toBe(5);
    expect(summary.arms.present.causalRedBeforeEditCount).toBe(5);
    expect(summary.arms.stripped.causalRedBeforeEditCount).toBe(0);
    expect(summary.pairedAB.workspacePass.netDeltaCount).toBe(0);
    expect(summary.pairedAB.causalRedBeforeEdit.netDeltaCount).toBe(5);
    expect(summary.noiseAA.causalRedDisagreements).toBe(0);
    expect(summary.arms.present.totalHostRecordedUsd).toBe(0);
  });
});
