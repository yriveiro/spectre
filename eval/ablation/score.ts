import type { JudgePairResult } from "./judge";
import type { AblationArm } from "./stage";
import type {
  ActivationMetrics,
  CausalTrajectoryMetrics,
  HostCostMetrics,
} from "./trajectory";
import type { WorkspaceVerification } from "./verify";

export type TrialCompletionStatus =
  | "completed"
  | "incomplete"
  | "timed_out"
  | "host_error"
  | "aborted";

export interface ScheduledTrial {
  readonly trialIndex: number;
  readonly slotIndex: number;
  readonly arm: AblationArm;
}

export interface TrialRecord {
  readonly trialIndex: number;
  readonly arm: AblationArm;
  readonly scenarioId: string;
  readonly completion: {
    readonly status: TrialCompletionStatus;
    readonly reason?: string;
  };
  readonly registrationVerified: boolean;
  readonly activation: ActivationMetrics;
  readonly trajectory: CausalTrajectoryMetrics;
  readonly workspace: WorkspaceVerification;
  readonly cost: HostCostMetrics;
  readonly durationMs: number;
}

export interface ArmSummary {
  readonly arm: AblationArm;
  readonly scheduled: number;
  readonly completed: number;
  readonly incomplete: number;
  readonly activatedCount: number;
  readonly workspacePassCount: number;
  readonly causalRedBeforeEditCount: number;
  readonly meanToolCalls: number;
  readonly meanToolErrors: number;
  readonly meanAssistantTurns: number;
  readonly meanTotalTokens: number;
  readonly meanCacheReadTokens: number;
  readonly meanCacheWriteTokens: number;
  readonly totalHostRecordedUsd: number;
  readonly meanHostRecordedUsd: number;
}

export interface PairedBinaryComparison {
  readonly completePairs: number;
  readonly leftOnly: number;
  readonly rightOnly: number;
  readonly both: number;
  readonly neither: number;
  readonly netDeltaCount: number;
}

export interface DescriptiveNoiseSpread {
  readonly completePairs: number;
  readonly workspaceDisagreements: number;
  readonly causalRedDisagreements: number;
  readonly maxAbsTokenDelta: number;
  readonly meanAbsTokenDelta: number;
  readonly maxAbsTurnDelta: number;
  readonly meanAbsTurnDelta: number;
  readonly maxAbsToolErrorDelta: number;
  readonly meanAbsToolErrorDelta: number;
  readonly maxAbsHostUsdDelta: number;
  readonly meanAbsHostUsdDelta: number;
}

export interface JudgePairTallies {
  readonly totalPairs: number;
  readonly left: number;
  readonly right: number;
  readonly tie: number;
  readonly unresolved: number;
  readonly unparseable: number;
  readonly totalHostRecordedUsd: number;
}

export interface ValidityGates {
  readonly stagedAuditPassed: boolean;
  readonly hostRegistrationVerified: boolean;
  readonly blindingVerified: boolean;
  readonly crossFamilyJudgeVerified: boolean;
  readonly zeroSystemicFailures: boolean;
  readonly allPassed: boolean;
}

export type AblationVerdict = "positive_signal" | "negative_signal" | "inconclusive";

export interface AblationSummary {
  readonly scenarioId: string;
  readonly targetSkill: string;
  readonly trialsPerArm: number;
  readonly minPairsForSignal: number;
  readonly arms: {
    readonly present: ArmSummary;
    readonly stripped: ArmSummary;
    readonly replicate: ArmSummary;
  };
  readonly pairedAB: {
    readonly workspacePass: PairedBinaryComparison;
    readonly causalRedBeforeEdit: PairedBinaryComparison;
    readonly meanTokenDelta: number;
    readonly meanTurnDelta: number;
    readonly meanToolErrorDelta: number;
    readonly meanHostUsdDelta: number;
  };
  readonly noiseAA: DescriptiveNoiseSpread;
  readonly judge?: {
    readonly ab: JudgePairTallies;
    readonly aa: JudgePairTallies;
  };
  readonly validity: ValidityGates;
  readonly verdict: AblationVerdict;
  readonly verdictReasons: ReadonlyArray<string>;
}

const BLOCK_ORDERS: ReadonlyArray<readonly [AblationArm, AblationArm, AblationArm]> = [
  ["present", "stripped", "replicate"],
  ["stripped", "replicate", "present"],
  ["replicate", "present", "stripped"],
  ["present", "replicate", "stripped"],
  ["replicate", "stripped", "present"],
  ["stripped", "present", "replicate"],
];

export const buildTrialSchedule = (trialsPerArm: number): ReadonlyArray<ScheduledTrial> => {
  if (!Number.isInteger(trialsPerArm) || trialsPerArm < 1) {
    throw new Error(`trialsPerArm must be a positive integer (got ${trialsPerArm})`);
  }
  const schedule: Array<ScheduledTrial> = [];
  for (let trialIndex = 0; trialIndex < trialsPerArm; trialIndex++) {
    const order = BLOCK_ORDERS[trialIndex % BLOCK_ORDERS.length]!;
    order.forEach((arm, slotIndex) => {
      schedule.push({ trialIndex, slotIndex, arm });
    });
  }
  return schedule;
};

const mean = (values: ReadonlyArray<number>): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

const summarizeArm = (
  arm: AblationArm,
  scheduled: number,
  trials: ReadonlyArray<TrialRecord>,
): ArmSummary => {
  const mine = trials.filter((trial) => trial.arm === arm);
  const completed = mine.filter((trial) => trial.completion.status === "completed");
  const incomplete = scheduled - completed.length;
  const totalUsd = completed.reduce((sum, trial) => sum + trial.cost.hostRecordedUsd, 0);

  return {
    arm,
    scheduled,
    completed: completed.length,
    incomplete,
    activatedCount: completed.filter((trial) => trial.activation.targetSkillLoaded).length,
    workspacePassCount: completed.filter((trial) => trial.workspace.passed).length,
    causalRedBeforeEditCount: completed.filter((trial) => trial.trajectory.causalRedBeforeEdit)
      .length,
    meanToolCalls: mean(completed.map((trial) => trial.trajectory.toolCalls)),
    meanToolErrors: mean(completed.map((trial) => trial.trajectory.toolErrors)),
    meanAssistantTurns: mean(completed.map((trial) => trial.trajectory.assistantTurns)),
    meanTotalTokens: mean(completed.map((trial) => trial.cost.usage.total)),
    meanCacheReadTokens: mean(completed.map((trial) => trial.cost.usage.cacheRead)),
    meanCacheWriteTokens: mean(completed.map((trial) => trial.cost.usage.cacheWrite)),
    totalHostRecordedUsd: totalUsd,
    meanHostRecordedUsd: mean(completed.map((trial) => trial.cost.hostRecordedUsd)),
  };
};

const collectCompletePairs = (
  trials: ReadonlyArray<TrialRecord>,
  leftArm: AblationArm,
  rightArm: AblationArm,
): ReadonlyArray<{ readonly left: TrialRecord; readonly right: TrialRecord }> => {
  const leftByIndex = new Map<number, TrialRecord>();
  const rightByIndex = new Map<number, TrialRecord>();
  for (const trial of trials) {
    if (trial.completion.status !== "completed") continue;
    if (trial.arm === leftArm) leftByIndex.set(trial.trialIndex, trial);
    else if (trial.arm === rightArm) rightByIndex.set(trial.trialIndex, trial);
  }
  const pairs: Array<{ readonly left: TrialRecord; readonly right: TrialRecord }> = [];
  for (const index of [...leftByIndex.keys()].toSorted((a, b) => a - b)) {
    const left = leftByIndex.get(index);
    const right = rightByIndex.get(index);
    if (left !== undefined && right !== undefined) {
      pairs.push({ left, right });
    }
  }
  return pairs;
};

const comparePairedBinary = (
  pairs: ReadonlyArray<{ readonly left: TrialRecord; readonly right: TrialRecord }>,
  predicate: (trial: TrialRecord) => boolean,
): PairedBinaryComparison => {
  let leftOnly = 0;
  let rightOnly = 0;
  let both = 0;
  let neither = 0;
  for (const pair of pairs) {
    const l = predicate(pair.left);
    const r = predicate(pair.right);
    if (l && !r) leftOnly++;
    else if (!l && r) rightOnly++;
    else if (l && r) both++;
    else neither++;
  }
  return {
    completePairs: pairs.length,
    leftOnly,
    rightOnly,
    both,
    neither,
    netDeltaCount: leftOnly - rightOnly,
  };
};

const summarizeNoiseSpread = (
  pairs: ReadonlyArray<{ readonly left: TrialRecord; readonly right: TrialRecord }>,
): DescriptiveNoiseSpread => {
  const tokenDeltas = pairs.map((p) => Math.abs(p.left.cost.usage.total - p.right.cost.usage.total));
  const turnDeltas = pairs.map((p) =>
    Math.abs(p.left.trajectory.assistantTurns - p.right.trajectory.assistantTurns),
  );
  const errorDeltas = pairs.map((p) =>
    Math.abs(p.left.trajectory.toolErrors - p.right.trajectory.toolErrors),
  );
  const usdDeltas = pairs.map((p) =>
    Math.abs(p.left.cost.hostRecordedUsd - p.right.cost.hostRecordedUsd),
  );

  return {
    completePairs: pairs.length,
    workspaceDisagreements: pairs.filter(
      (p) => p.left.workspace.passed !== p.right.workspace.passed,
    ).length,
    causalRedDisagreements: pairs.filter(
      (p) => p.left.trajectory.causalRedBeforeEdit !== p.right.trajectory.causalRedBeforeEdit,
    ).length,
    maxAbsTokenDelta: tokenDeltas.length === 0 ? 0 : Math.max(...tokenDeltas),
    meanAbsTokenDelta: mean(tokenDeltas),
    maxAbsTurnDelta: turnDeltas.length === 0 ? 0 : Math.max(...turnDeltas),
    meanAbsTurnDelta: mean(turnDeltas),
    maxAbsToolErrorDelta: errorDeltas.length === 0 ? 0 : Math.max(...errorDeltas),
    meanAbsToolErrorDelta: mean(errorDeltas),
    maxAbsHostUsdDelta: usdDeltas.length === 0 ? 0 : Math.max(...usdDeltas),
    meanAbsHostUsdDelta: mean(usdDeltas),
  };
};

export const tallyJudgePairs = (results: ReadonlyArray<JudgePairResult>): JudgePairTallies => ({
  totalPairs: results.length,
  left: results.filter((item) => item.outcome === "left").length,
  right: results.filter((item) => item.outcome === "right").length,
  tie: results.filter((item) => item.outcome === "tie").length,
  unresolved: results.filter((item) => item.outcome === "unresolved").length,
  unparseable: results.filter((item) => item.outcome === "unparseable").length,
  totalHostRecordedUsd: results.reduce((sum, item) => sum + item.hostRecordedUsd, 0),
});

export const summarizeAblation = (input: {
  readonly scenarioId: string;
  readonly targetSkill: string;
  readonly trialsPerArm: number;
  readonly trials: ReadonlyArray<TrialRecord>;
  readonly judgeAB?: ReadonlyArray<JudgePairResult>;
  readonly judgeAA?: ReadonlyArray<JudgePairResult>;
  readonly validity: ValidityGates;
  readonly minPairsForSignal?: number;
}): AblationSummary => {
  const minPairsForSignal = input.minPairsForSignal ?? 5;
  const arms = {
    present: summarizeArm("present", input.trialsPerArm, input.trials),
    stripped: summarizeArm("stripped", input.trialsPerArm, input.trials),
    replicate: summarizeArm("replicate", input.trialsPerArm, input.trials),
  };

  const abPairs = collectCompletePairs(input.trials, "present", "stripped");
  const aaPairs = collectCompletePairs(input.trials, "present", "replicate");

  const pairedAB = {
    workspacePass: comparePairedBinary(abPairs, (trial) => trial.workspace.passed),
    causalRedBeforeEdit: comparePairedBinary(
      abPairs,
      (trial) => trial.trajectory.causalRedBeforeEdit,
    ),
    meanTokenDelta: mean(abPairs.map((p) => p.left.cost.usage.total - p.right.cost.usage.total)),
    meanTurnDelta: mean(
      abPairs.map((p) => p.left.trajectory.assistantTurns - p.right.trajectory.assistantTurns),
    ),
    meanToolErrorDelta: mean(
      abPairs.map((p) => p.left.trajectory.toolErrors - p.right.trajectory.toolErrors),
    ),
    meanHostUsdDelta: mean(
      abPairs.map((p) => p.left.cost.hostRecordedUsd - p.right.cost.hostRecordedUsd),
    ),
  };

  const noiseAA = summarizeNoiseSpread(aaPairs);
  const judge =
    input.judgeAB !== undefined || input.judgeAA !== undefined
      ? {
          ab: tallyJudgePairs(input.judgeAB ?? []),
          aa: tallyJudgePairs(input.judgeAA ?? []),
        }
      : undefined;

  const blockers: Array<string> = [];
  if (!input.validity.allPassed) blockers.push("validity_gate_failed");
  if (arms.present.incomplete > 0 || arms.stripped.incomplete > 0 || arms.replicate.incomplete > 0) {
    blockers.push("incomplete_trials");
  }
  if (arms.stripped.activatedCount > 0) blockers.push("stripped_arm_loaded_target_skill");
  if (arms.present.activatedCount === 0) blockers.push("unexposed_treatment");
  if (pairedAB.workspacePass.completePairs < minPairsForSignal) blockers.push("small_sample");

  let verdict: AblationVerdict;
  let verdictReasons: ReadonlyArray<string>;

  if (blockers.length > 0) {
    verdict = "inconclusive";
    verdictReasons = blockers;
  } else if (pairedAB.workspacePass.netDeltaCount < -noiseAA.workspaceDisagreements) {
    verdict = "negative_signal";
    verdictReasons = ["workspace_pass_regressed_beyond_aa_spread"];
  } else if (
    pairedAB.workspacePass.netDeltaCount >= 0 &&
    (pairedAB.workspacePass.netDeltaCount > noiseAA.workspaceDisagreements ||
      pairedAB.causalRedBeforeEdit.netDeltaCount > noiseAA.causalRedDisagreements)
  ) {
    verdict = "positive_signal";
    verdictReasons = ["paired_lift_exceeds_aa_spread"];
  } else {
    verdict = "inconclusive";
    verdictReasons = ["within_aa_noise_spread"];
  }

  return {
    scenarioId: input.scenarioId,
    targetSkill: input.targetSkill,
    trialsPerArm: input.trialsPerArm,
    minPairsForSignal,
    arms,
    pairedAB,
    noiseAA,
    ...(judge === undefined ? {} : { judge }),
    validity: input.validity,
    verdict,
    verdictReasons,
  };
};
