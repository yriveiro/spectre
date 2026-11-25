import type { EscalationReason } from "../../tools/definitions/routing";
import type { ObservedDelegation } from "./observe";
import type { DelegationScenario, ScenarioSlice } from "./scenario";

export interface TrialObservation {
  readonly scenarioId: string;
  readonly slice: ScenarioSlice;
  readonly arm: "baseline" | "candidate";
  readonly trial: number;
  readonly taskPassed: boolean;
  readonly loadedModelRouter: boolean;
  readonly routingCalls: number;
  readonly subagentCalls: ReadonlyArray<{
    readonly agent?: string;
    readonly model?: string;
    readonly hasInputSessionID: boolean;
    readonly outputSessionID?: string;
    readonly switchedModelOnResume: boolean;
  }>;
  readonly operatorSpawns: number;
  readonly escalations: ReadonlyArray<{
    readonly childSessionID: string;
    readonly structured: boolean;
    readonly reason?: EscalationReason;
    readonly childAssistantTurns: number;
    readonly continuedSameSession: boolean;
    readonly upgradedModel: boolean;
  }>;
  readonly outOfScopeMutations: ReadonlyArray<string>;
  readonly parentPeakInputTokens: number;
  readonly parentTotalTokens: number;
  readonly childTotalTokens: number;
  readonly frontierTokenShare: number;
  readonly catalogueCostUnits: number;
  readonly regretAdjustedCostUnits: number;
}

export interface ArmSummary {
  readonly arm: "baseline" | "candidate";
  readonly trials: number;
  readonly correctnessRate: number;
  readonly boundedDelegationRecall: number;
  readonly inlineNegativePrecision: number;
  readonly structuredEscalationRate: number;
  readonly escalationSessionReuseRate: number;
  readonly meanWorkerTurnsOnTrap: number;
  readonly meanParentPeakInputTokens: number;
  readonly meanFrontierTokenShare: number;
  readonly meanCatalogueCostUnits: number;
  readonly meanRegretAdjustedCostUnits: number;
}

export interface ScenarioFlip {
  readonly scenarioId: string;
  readonly slice: ScenarioSlice;
  readonly metric: "taskPassed" | "delegatedCorrectly" | "escalatedCleanly";
  readonly baselinePassCount: number;
  readonly candidatePassCount: number;
  readonly direction: "gain" | "regression";
}

export interface ReleaseGateCheck {
  readonly name: string;
  readonly passed: boolean;
  readonly actual: string;
  readonly threshold: string;
}

export interface ReleaseGateVerdict {
  readonly passed: boolean;
  readonly checks: ReadonlyArray<ReleaseGateCheck>;
}

export interface ABComparisonReport {
  readonly baselineRef: string;
  readonly orchestratorModel: string;
  readonly trialsPerScenario: number;
  readonly baseline: ArmSummary;
  readonly candidate: ArmSummary;
  readonly delta: {
    readonly correctnessRate: number;
    readonly boundedDelegationRecall: number;
    readonly inlineNegativePrecision: number;
    readonly structuredEscalationRate: number;
    readonly escalationSessionReuseRate: number;
    readonly parentPeakInputTokensPct: number;
    readonly regretAdjustedCostPct: number;
  };
  readonly flips: ReadonlyArray<ScenarioFlip>;
  readonly gates: ReleaseGateVerdict;
}

export const evaluateTaskPassed = (
  scenario: DelegationScenario,
  observed: ObservedDelegation,
  verifyExitCode?: number,
): boolean => {
  if (observed.parentFailed) return false;
  if (verifyExitCode !== undefined && verifyExitCode !== 0) return false;
  if (observed.outOfScopeMutations.length > 0) return false;

  if (scenario.expect.expectedFiles !== undefined) {
    for (const [path, expected] of Object.entries(scenario.expect.expectedFiles)) {
      const actual = observed.workspaceFiles[path];
      if (actual === undefined || actual !== expected.trimEnd()) return false;
    }
  }

  if (scenario.expect.requiredAnswerSubstrings !== undefined) {
    for (const needle of scenario.expect.requiredAnswerSubstrings) {
      if (!observed.parentFinalText.includes(needle)) return false;
    }
  }

  return true;
};

export const scoreTrial = (input: {
  readonly scenario: DelegationScenario;
  readonly arm: "baseline" | "candidate";
  readonly trial: number;
  readonly observed: ObservedDelegation;
  readonly verifyExitCode?: number;
  readonly baselineCostUnits?: number;
}): TrialObservation => {
  const taskPassed = evaluateTaskPassed(input.scenario, input.observed, input.verifyExitCode);
  const redoPenalty = taskPassed
    ? 0
    : (input.baselineCostUnits ?? Math.max(input.observed.catalogueCostUnits, 1));
  const regretAdjustedCostUnits = input.observed.catalogueCostUnits + redoPenalty;

  return {
    scenarioId: input.scenario.id,
    slice: input.scenario.slice,
    arm: input.arm,
    trial: input.trial,
    taskPassed,
    loadedModelRouter: input.observed.loadedModelRouter,
    routingCalls: input.observed.routingCalls,
    subagentCalls: input.observed.subagentCalls.map((call) => ({
      agent: call.agent,
      model: call.model,
      hasInputSessionID: call.hasInputSessionID,
      outputSessionID: call.outputSessionID,
      switchedModelOnResume: call.switchedModelOnResume,
    })),
    operatorSpawns: input.observed.operatorSpawns,
    escalations: input.observed.escalations,
    outOfScopeMutations: input.observed.outOfScopeMutations,
    parentPeakInputTokens: input.observed.parentPeakInputTokens,
    parentTotalTokens: input.observed.parentTotalTokens,
    childTotalTokens: input.observed.childTotalTokens,
    frontierTokenShare: input.observed.frontierTokenShare,
    catalogueCostUnits: input.observed.catalogueCostUnits,
    regretAdjustedCostUnits,
  };
};

const mean = (values: ReadonlyArray<number>): number =>
  values.length === 0 ? 0 : values.reduce((sum, one) => sum + one, 0) / values.length;

const rate = <T>(items: ReadonlyArray<T>, predicate: (item: T) => boolean): number =>
  items.length === 0 ? 0 : items.filter(predicate).length / items.length;

const delegatedCorrectly = (scenario: DelegationScenario, trial: TrialObservation): boolean => {
  if (scenario.slice === "inline-negative") {
    return trial.subagentCalls.length === 0 && !trial.loadedModelRouter;
  }
  return trial.operatorSpawns >= 1;
};

const escalatedCleanly = (scenario: DelegationScenario, trial: TrialObservation): boolean => {
  const expected = scenario.expect.escalation;
  if (expected === undefined) return false;
  if (trial.outOfScopeMutations.length > 0) return false;
  const maxTurns = scenario.expect.maxWorkerTurnsBeforeStop;
  return trial.escalations.some((esc) => {
    if (!esc.structured) return false;
    if (esc.reason !== expected.reason) return false;
    if (maxTurns !== undefined && esc.childAssistantTurns > maxTurns) return false;
    if (!esc.continuedSameSession) return false;
    return expected.resolution === "same-session-upgrade-model"
      ? esc.upgradedModel
      : !esc.upgradedModel;
  });
};

export const summarizeArm = (
  arm: "baseline" | "candidate",
  scenarios: ReadonlyArray<DelegationScenario>,
  trials: ReadonlyArray<TrialObservation>,
): ArmSummary => {
  const byScenario = new Map(scenarios.map((one) => [one.id, one]));
  const bounded = trials.filter((t) => t.slice === "bounded-delegate");
  const inlineNeg = trials.filter((t) => t.slice === "inline-negative");
  const traps = trials.filter((t) => t.slice === "worker-escalate");

  return {
    arm,
    trials: trials.length,
    correctnessRate: rate(trials, (t) => t.taskPassed),
    boundedDelegationRecall: rate(bounded, (t) => t.operatorSpawns >= 1),
    inlineNegativePrecision: rate(
      inlineNeg,
      (t) => t.subagentCalls.length === 0 && !t.loadedModelRouter,
    ),
    structuredEscalationRate: rate(traps, (t) => {
      const expected = byScenario.get(t.scenarioId)?.expect.escalation;
      return t.escalations.some(
        (esc) => esc.structured && (expected === undefined || esc.reason === expected.reason),
      );
    }),
    escalationSessionReuseRate: rate(traps, (t) => {
      const scenario = byScenario.get(t.scenarioId);
      return scenario === undefined ? false : escalatedCleanly(scenario, t);
    }),
    meanWorkerTurnsOnTrap: mean(
      traps.flatMap((t) => t.escalations.map((esc) => esc.childAssistantTurns)),
    ),
    meanParentPeakInputTokens: mean(trials.map((t) => t.parentPeakInputTokens)),
    meanFrontierTokenShare: mean(trials.map((t) => t.frontierTokenShare)),
    meanCatalogueCostUnits: mean(trials.map((t) => t.catalogueCostUnits)),
    meanRegretAdjustedCostUnits: mean(trials.map((t) => t.regretAdjustedCostUnits)),
  };
};

export const detectFlips = (
  scenarios: ReadonlyArray<DelegationScenario>,
  baselineTrials: ReadonlyArray<TrialObservation>,
  candidateTrials: ReadonlyArray<TrialObservation>,
): ReadonlyArray<ScenarioFlip> => {
  const flips: Array<ScenarioFlip> = [];

  for (const scenario of scenarios) {
    const base = baselineTrials.filter((t) => t.scenarioId === scenario.id);
    const cand = candidateTrials.filter((t) => t.scenarioId === scenario.id);
    if (base.length === 0 && cand.length === 0) continue;

    const metrics: Array<{
      readonly name: ScenarioFlip["metric"];
      readonly check: (t: TrialObservation) => boolean;
      readonly active: boolean;
    }> = [
      { name: "taskPassed", check: (t) => t.taskPassed, active: true },
      {
        name: "delegatedCorrectly",
        check: (t) => delegatedCorrectly(scenario, t),
        active: true,
      },
      {
        name: "escalatedCleanly",
        check: (t) => escalatedCleanly(scenario, t),
        active: scenario.slice === "worker-escalate",
      },
    ];

    for (const metric of metrics) {
      if (!metric.active) continue;
      const baselinePassCount = base.filter(metric.check).length;
      const candidatePassCount = cand.filter(metric.check).length;
      if (baselinePassCount !== candidatePassCount) {
        flips.push({
          scenarioId: scenario.id,
          slice: scenario.slice,
          metric: metric.name,
          baselinePassCount,
          candidatePassCount,
          direction: candidatePassCount > baselinePassCount ? "gain" : "regression",
        });
      }
    }
  }

  return flips;
};

const pctDelta = (base: number, cand: number): number =>
  base === 0 ? 0 : ((cand - base) / base) * 100;

export const evaluateReleaseGates = (input: {
  readonly scenarios: ReadonlyArray<DelegationScenario>;
  readonly baseline: ArmSummary;
  readonly candidate: ArmSummary;
  readonly flips: ReadonlyArray<ScenarioFlip>;
}): ReleaseGateVerdict => {
  const hasBounded = input.scenarios.some((s) => s.slice === "bounded-delegate");
  const hasInlineNeg = input.scenarios.some((s) => s.slice === "inline-negative");
  const hasTraps = input.scenarios.some((s) => s.slice === "worker-escalate");
  const taskRegressions = input.flips.filter(
    (f) => f.metric === "taskPassed" && f.direction === "regression",
  );

  const checks: Array<ReleaseGateCheck> = [
    {
      name: "correctness_non_regression",
      passed: input.candidate.correctnessRate >= input.baseline.correctnessRate,
      actual: `${(input.candidate.correctnessRate * 100).toFixed(1)}% vs ${(input.baseline.correctnessRate * 100).toFixed(1)}%`,
      threshold: ">= baseline",
    },
    {
      name: "no_task_regressions",
      passed: taskRegressions.length === 0,
      actual: String(taskRegressions.length),
      threshold: "0 regressions",
    },
  ];

  if (hasBounded) {
    checks.push({
      name: "bounded_delegation_recall",
      passed: input.candidate.boundedDelegationRecall >= 0.8,
      actual: `${(input.candidate.boundedDelegationRecall * 100).toFixed(1)}%`,
      threshold: ">= 80.0%",
    });
  }

  if (hasInlineNeg) {
    checks.push({
      name: "inline_negative_precision",
      passed: input.candidate.inlineNegativePrecision >= 0.8,
      actual: `${(input.candidate.inlineNegativePrecision * 100).toFixed(1)}%`,
      threshold: ">= 80.0%",
    });
  }

  if (hasTraps) {
    checks.push({
      name: "structured_escalation_rate",
      passed: input.candidate.structuredEscalationRate >= 0.8,
      actual: `${(input.candidate.structuredEscalationRate * 100).toFixed(1)}%`,
      threshold: ">= 80.0%",
    });
  }

  if (input.baseline.meanRegretAdjustedCostUnits > 0) {
    checks.push({
      name: "regret_adjusted_cost_non_regression",
      passed:
        input.candidate.meanRegretAdjustedCostUnits <= input.baseline.meanRegretAdjustedCostUnits,
      actual: `${input.candidate.meanRegretAdjustedCostUnits.toFixed(4)} vs ${input.baseline.meanRegretAdjustedCostUnits.toFixed(4)}`,
      threshold: "<= baseline",
    });
  }

  return {
    passed: checks.every((c) => c.passed),
    checks,
  };
};

export const compareArms = (input: {
  readonly baselineRef: string;
  readonly orchestratorModel: string;
  readonly trialsPerScenario: number;
  readonly scenarios: ReadonlyArray<DelegationScenario>;
  readonly baselineTrials: ReadonlyArray<TrialObservation>;
  readonly candidateTrials: ReadonlyArray<TrialObservation>;
}): ABComparisonReport => {
  const baseline = summarizeArm("baseline", input.scenarios, input.baselineTrials);
  const candidate = summarizeArm("candidate", input.scenarios, input.candidateTrials);
  const flips = detectFlips(input.scenarios, input.baselineTrials, input.candidateTrials);
  const gates = evaluateReleaseGates({
    scenarios: input.scenarios,
    baseline,
    candidate,
    flips,
  });

  return {
    baselineRef: input.baselineRef,
    orchestratorModel: input.orchestratorModel,
    trialsPerScenario: input.trialsPerScenario,
    baseline,
    candidate,
    delta: {
      correctnessRate: candidate.correctnessRate - baseline.correctnessRate,
      boundedDelegationRecall: candidate.boundedDelegationRecall - baseline.boundedDelegationRecall,
      inlineNegativePrecision: candidate.inlineNegativePrecision - baseline.inlineNegativePrecision,
      structuredEscalationRate:
        candidate.structuredEscalationRate - baseline.structuredEscalationRate,
      escalationSessionReuseRate:
        candidate.escalationSessionReuseRate - baseline.escalationSessionReuseRate,
      parentPeakInputTokensPct: pctDelta(
        baseline.meanParentPeakInputTokens,
        candidate.meanParentPeakInputTokens,
      ),
      regretAdjustedCostPct: pctDelta(
        baseline.meanRegretAdjustedCostUnits,
        candidate.meanRegretAdjustedCostUnits,
      ),
    },
    flips,
    gates,
  };
};

const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;
const signedPct = (value: number): string => `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;

export const formatComparisonTable = (report: ABComparisonReport): string => {
  const rows: ReadonlyArray<[string, string, string, string]> = [
    [
      "Correctness",
      pct(report.baseline.correctnessRate),
      pct(report.candidate.correctnessRate),
      signedPct(report.delta.correctnessRate * 100),
    ],
    [
      "Bounded Delegation Recall",
      pct(report.baseline.boundedDelegationRecall),
      pct(report.candidate.boundedDelegationRecall),
      signedPct(report.delta.boundedDelegationRecall * 100),
    ],
    [
      "Inline Negative Precision",
      pct(report.baseline.inlineNegativePrecision),
      pct(report.candidate.inlineNegativePrecision),
      signedPct(report.delta.inlineNegativePrecision * 100),
    ],
    [
      "Structured Escalation Rate",
      pct(report.baseline.structuredEscalationRate),
      pct(report.candidate.structuredEscalationRate),
      signedPct(report.delta.structuredEscalationRate * 100),
    ],
    [
      "Escalation Session Reuse",
      pct(report.baseline.escalationSessionReuseRate),
      pct(report.candidate.escalationSessionReuseRate),
      signedPct(report.delta.escalationSessionReuseRate * 100),
    ],
    [
      "Parent Peak Input Tokens",
      report.baseline.meanParentPeakInputTokens.toFixed(0),
      report.candidate.meanParentPeakInputTokens.toFixed(0),
      signedPct(report.delta.parentPeakInputTokensPct),
    ],
    [
      "Frontier Token Share",
      pct(report.baseline.meanFrontierTokenShare),
      pct(report.candidate.meanFrontierTokenShare),
      signedPct(
        (report.candidate.meanFrontierTokenShare - report.baseline.meanFrontierTokenShare) * 100,
      ),
    ],
    [
      "Regret-Adjusted Cost",
      report.baseline.meanRegretAdjustedCostUnits.toFixed(4),
      report.candidate.meanRegretAdjustedCostUnits.toFixed(4),
      signedPct(report.delta.regretAdjustedCostPct),
    ],
  ];

  const lines: Array<string> = [
    `Delegation A/B Report (baseline=${report.baselineRef}, model=${report.orchestratorModel}, trials=${report.trialsPerScenario})`,
    "",
    "| Metric | Baseline | Candidate | Delta |",
    "| --- | ---: | ---: | ---: |",
    ...rows.map(([m, b, c, d]) => `| ${m} | ${b} | ${c} | ${d} |`),
  ];

  if (report.flips.length > 0) {
    lines.push("", "Scenario Flips:");
    for (const flip of report.flips) {
      lines.push(
        `- [${flip.direction.toUpperCase()}] ${flip.scenarioId} (${flip.slice}) ${flip.metric}: ${flip.baselinePassCount} -> ${flip.candidatePassCount}`,
      );
    }
  }

  lines.push("", `Release Gates: ${report.gates.passed ? "PASS" : "FAIL"}`);
  for (const check of report.gates.checks) {
    lines.push(
      `- [${check.passed ? "PASS" : "FAIL"}] ${check.name}: ${check.actual} (threshold: ${check.threshold})`,
    );
  }

  return lines.join("\n");
};
