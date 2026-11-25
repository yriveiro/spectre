import { DEFAULT_PROFILES, type EscalationReason } from "../../tools/definitions/routing";
import type { ObservedDelegation, RoutedProfileObservation } from "./observe";
import type { DelegationScenario, ScenarioSlice } from "./scenario";

export interface TrialObservation {
  readonly scenarioId: string;
  readonly slice: ScenarioSlice;
  readonly arm: "baseline" | "candidate";
  readonly trial: number;
  readonly taskPassed: boolean;
  readonly loadedModelRouter: boolean;
  readonly routingCalls: number;
  readonly routedProfiles?: ReadonlyArray<RoutedProfileObservation>;
  readonly subagentCalls: ReadonlyArray<{
    readonly agent?: string;
    readonly model?: string;
    readonly hasInputSessionID: boolean;
    readonly outputSessionID?: string;
    readonly switchedModelOnResume: boolean;
    readonly upgradedModelOnResume?: boolean;
  }>;
  readonly operatorSpawns: number;
  readonly escalations: ReadonlyArray<{
    readonly childSessionID: string;
    readonly structured: boolean;
    readonly reason?: EscalationReason;
    readonly childAssistantTurns: number;
    readonly continuedSameSession: boolean;
    readonly upgradedModel: boolean;
    readonly switchedModel?: boolean;
  }>;
  readonly outOfScopeMutations: ReadonlyArray<string>;
  readonly unexpectedFileMutations: ReadonlyArray<string>;
  readonly verifiedAfterLastEdit: boolean;
  readonly parentPeakInputTokens: number;
  readonly parentTotalTokens: number;
  readonly childTotalTokens: number;
  readonly frontierTokenShare: number;
  readonly catalogueCostUnits: number;
  readonly regretAdjustedCostUnits: number;
}

export interface RateInterval {
  readonly passes: number;
  readonly total: number;
  readonly rate: number;
  readonly low: number;
  readonly high: number;
}

export interface ArmSummary {
  readonly arm: "baseline" | "candidate";
  readonly trials: number;
  readonly correctnessRate: number;
  readonly boundedDelegationRecall: number;
  readonly inlineNegativePrecision: number;
  readonly structuredEscalationRate: number;
  readonly escalationSessionReuseRate: number;
  readonly verificationHygieneRate: number;
  readonly meanWorkerTurnsOnTrap: number;
  readonly meanParentPeakInputTokens: number;
  readonly meanFrontierTokenShare: number;
  readonly meanCatalogueCostUnits: number;
  readonly meanRegretAdjustedCostUnits: number;
  readonly intervals: {
    readonly correctness: RateInterval;
    readonly boundedDelegation: RateInterval;
    readonly inlineNegative: RateInterval;
    readonly structuredEscalation: RateInterval;
    readonly escalationSessionReuse: RateInterval;
  };
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

export const wilsonInterval = (
  passes: number,
  total: number,
  z = 1.959963984540054,
): { readonly low: number; readonly high: number } => {
  if (total <= 0) return { low: 0, high: 0 };
  const p = Math.min(1, Math.max(0, passes / total));
  const z2 = z * z;
  const denom = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total))) / denom;
  return {
    low: Math.max(0, center - half),
    high: Math.min(1, center + half),
  };
};

const summarizeRate = <T>(
  items: ReadonlyArray<T>,
  predicate: (item: T) => boolean,
): RateInterval => {
  const total = items.length;
  const passes = items.filter(predicate).length;
  const r = total === 0 ? 0 : passes / total;
  const { low, high } = wilsonInterval(passes, total);
  return { passes, total, rate: r, low, high };
};

export const evaluateTaskPassed = (
  scenario: DelegationScenario,
  observed: ObservedDelegation,
  verifyExitCode?: number,
): boolean => {
  if (
    observed.parentFailed ||
    (verifyExitCode !== undefined && verifyExitCode !== 0) ||
    observed.outOfScopeMutations.length > 0 ||
    observed.unexpectedFileMutations.length > 0
  ) {
    return false;
  }

  for (const [path, expected] of Object.entries(scenario.expect.expectedFiles ?? {})) {
    const actual = observed.workspaceFiles[path];
    if (actual === undefined || actual !== expected.trimEnd()) return false;
  }

  for (const needle of scenario.expect.requiredAnswerSubstrings ?? []) {
    if (!observed.parentFinalText.includes(needle)) return false;
  }

  return true;
};

const effectiveCostUnits = (observed: ObservedDelegation): number => {
  if (observed.catalogueCostUnits > 0) return observed.catalogueCostUnits;
  if (observed.parentTotalTokens <= 0 && observed.childTotalTokens <= 0) return 0;
  return observed.parentTotalTokens * 1e-6 + observed.childTotalTokens * 0.25 * 1e-6;
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
  const catalogueCostUnits = effectiveCostUnits(input.observed);
  const redoPenalty = taskPassed
    ? 0
    : (input.baselineCostUnits ?? Math.max(catalogueCostUnits, 1e-3));
  const regretAdjustedCostUnits = catalogueCostUnits + redoPenalty;

  return {
    scenarioId: input.scenario.id,
    slice: input.scenario.slice,
    arm: input.arm,
    trial: input.trial,
    taskPassed,
    loadedModelRouter: input.observed.loadedModelRouter,
    routingCalls: input.observed.routingCalls,
    ...(input.observed.routedProfiles === undefined
      ? {}
      : { routedProfiles: input.observed.routedProfiles }),
    subagentCalls: input.observed.subagentCalls.map((call) => ({
      agent: call.agent,
      model: call.model,
      hasInputSessionID: call.hasInputSessionID,
      outputSessionID: call.outputSessionID,
      switchedModelOnResume: call.switchedModelOnResume,
      ...(call.upgradedModelOnResume === undefined
        ? {}
        : { upgradedModelOnResume: call.upgradedModelOnResume }),
    })),
    operatorSpawns: input.observed.operatorSpawns,
    escalations: input.observed.escalations,
    outOfScopeMutations: input.observed.outOfScopeMutations,
    unexpectedFileMutations: input.observed.unexpectedFileMutations,
    verifiedAfterLastEdit: input.observed.verifiedAfterLastEdit,
    parentPeakInputTokens: input.observed.parentPeakInputTokens,
    parentTotalTokens: input.observed.parentTotalTokens,
    childTotalTokens: input.observed.childTotalTokens,
    frontierTokenShare: input.observed.frontierTokenShare,
    catalogueCostUnits,
    regretAdjustedCostUnits,
  };
};

const mean = (values: ReadonlyArray<number>): number =>
  values.length === 0 ? 0 : values.reduce((sum, one) => sum + one, 0) / values.length;

const baseOf = (ref: string): string => ref.split("#")[0] ?? ref;

const variantOf = (ref: string): string | undefined => {
  const idx = ref.indexOf("#");
  return idx === -1 || idx === ref.length - 1 ? undefined : ref.slice(idx + 1);
};

export const matchesAllowedProfile = (
  scenario: DelegationScenario,
  callModel: string | undefined,
  routedProfiles?: ReadonlyArray<RoutedProfileObservation>,
): boolean => {
  if (callModel === undefined) return false;
  const configuredBases = new Set(Object.values(scenario.spectreConfig.models).map(baseOf));
  const callBase = baseOf(callModel);

  const allowedList = scenario.expect.allowedProfiles;
  if (allowedList === undefined || allowedList.length === 0) {
    if (routedProfiles?.some((r) => r.modelRef !== undefined)) {
      return routedProfiles.some((r) => r.modelRef === callModel);
    }
    return configuredBases.has(callBase);
  }

  const allowed = new Set(allowedList);
  if (routedProfiles !== undefined && routedProfiles.length > 0) {
    const allowedRows = routedProfiles.filter((row) => allowed.has(row.profile));
    if (allowedRows.length === 0) return false;
    const withRefs = allowedRows.filter((row) => row.modelRef !== undefined);
    return withRefs.length > 0
      ? withRefs.some((row) => row.modelRef === callModel)
      : configuredBases.has(callBase);
  }

  if (!configuredBases.has(callBase)) return false;
  const variant = variantOf(callModel);
  if (variant === undefined) return true;
  const allowedEfforts = new Set(
    allowedList.flatMap((name) => {
      const eff = DEFAULT_PROFILES[name]?.effort;
      return eff === undefined ? [] : [eff];
    }),
  );
  return allowedEfforts.size === 0 || allowedEfforts.has(variant);
};

export const delegatedCorrectly = (
  scenario: DelegationScenario,
  trial: TrialObservation,
): boolean => {
  if (!scenario.expect.expectOperatorDelegation || scenario.slice === "inline-negative") {
    return trial.subagentCalls.length === 0 && !trial.loadedModelRouter && trial.routingCalls === 0;
  }
  if (!trial.loadedModelRouter || trial.routingCalls < 1 || trial.operatorSpawns < 1) {
    return false;
  }
  const spawns = trial.subagentCalls.filter(
    (call) => call.agent === "operator" && !call.hasInputSessionID,
  );
  return (
    spawns.length >= 1 &&
    spawns.every((call) => matchesAllowedProfile(scenario, call.model, trial.routedProfiles))
  );
};

export const escalatedCleanly = (
  scenario: DelegationScenario,
  trial: TrialObservation,
): boolean => {
  const expected = scenario.expect.escalation;
  if (expected === undefined || !delegatedCorrectly(scenario, trial)) return false;
  if (trial.outOfScopeMutations.length > 0) return false;
  const maxTurns = scenario.expect.maxWorkerTurnsBeforeStop;
  return trial.escalations.some((esc) => {
    if (!esc.structured || esc.reason !== expected.reason || !esc.continuedSameSession) {
      return false;
    }
    if (maxTurns !== undefined && esc.childAssistantTurns > maxTurns) return false;
    return expected.resolution === "same-session-upgrade-model"
      ? esc.upgradedModel
      : !esc.upgradedModel && esc.switchedModel !== true;
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

  const correctness = summarizeRate(trials, (t) => t.taskPassed);
  const boundedDelegation = summarizeRate(bounded, (t) => {
    const scenario = byScenario.get(t.scenarioId);
    return scenario === undefined ? false : delegatedCorrectly(scenario, t);
  });
  const inlineNegative = summarizeRate(inlineNeg, (t) => {
    const scenario = byScenario.get(t.scenarioId);
    return scenario === undefined ? false : delegatedCorrectly(scenario, t);
  });
  const structuredEscalation = summarizeRate(traps, (t) => {
    const expected = byScenario.get(t.scenarioId)?.expect.escalation;
    return t.escalations.some(
      (esc) => esc.structured && (expected === undefined || esc.reason === expected.reason),
    );
  });
  const escalationSessionReuse = summarizeRate(traps, (t) => {
    const scenario = byScenario.get(t.scenarioId);
    return scenario === undefined ? false : escalatedCleanly(scenario, t);
  });
  const verificationHygiene = summarizeRate(trials, (t) => t.verifiedAfterLastEdit);

  return {
    arm,
    trials: trials.length,
    correctnessRate: correctness.rate,
    boundedDelegationRecall: boundedDelegation.rate,
    inlineNegativePrecision: inlineNegative.rate,
    structuredEscalationRate: structuredEscalation.rate,
    escalationSessionReuseRate: escalationSessionReuse.rate,
    verificationHygieneRate: verificationHygiene.rate,
    meanWorkerTurnsOnTrap: mean(
      traps.flatMap((t) => t.escalations.map((esc) => esc.childAssistantTurns)),
    ),
    meanParentPeakInputTokens: mean(trials.map((t) => t.parentPeakInputTokens)),
    meanFrontierTokenShare: mean(trials.map((t) => t.frontierTokenShare)),
    meanCatalogueCostUnits: mean(trials.map((t) => t.catalogueCostUnits)),
    meanRegretAdjustedCostUnits: mean(trials.map((t) => t.regretAdjustedCostUnits)),
    intervals: {
      correctness,
      boundedDelegation,
      inlineNegative,
      structuredEscalation,
      escalationSessionReuse,
    },
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
      { name: "delegatedCorrectly", check: (t) => delegatedCorrectly(scenario, t), active: true },
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

const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;
const signedPct = (value: number): string => `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;

const rateGate = (name: string, rateValue: number, min = 0.8): ReleaseGateCheck => ({
  name,
  passed: rateValue >= min,
  actual: pct(rateValue),
  threshold: `>= ${pct(min)}`,
});

export const evaluateReleaseGates = (input: {
  readonly scenarios: ReadonlyArray<DelegationScenario>;
  readonly baseline: ArmSummary;
  readonly candidate: ArmSummary;
  readonly flips: ReadonlyArray<ScenarioFlip>;
}): ReleaseGateVerdict => {
  const slices = new Set(input.scenarios.map((s) => s.slice));
  const taskRegressions = input.flips.filter(
    (f) => f.metric === "taskPassed" && f.direction === "regression",
  );

  const checks: Array<ReleaseGateCheck> = [
    {
      name: "correctness_non_regression",
      passed: input.candidate.correctnessRate >= input.baseline.correctnessRate,
      actual: `${pct(input.candidate.correctnessRate)} vs ${pct(input.baseline.correctnessRate)}`,
      threshold: ">= baseline",
    },
    {
      name: "no_task_regressions",
      passed: taskRegressions.length === 0,
      actual: String(taskRegressions.length),
      threshold: "0 regressions",
    },
  ];

  if (slices.has("bounded-delegate")) {
    checks.push(rateGate("bounded_delegation_recall", input.candidate.boundedDelegationRecall));
  }
  if (slices.has("inline-negative")) {
    checks.push(rateGate("inline_negative_precision", input.candidate.inlineNegativePrecision));
  }
  if (slices.has("worker-escalate")) {
    checks.push(rateGate("structured_escalation_rate", input.candidate.structuredEscalationRate));
    checks.push(
      rateGate("escalation_session_reuse_rate", input.candidate.escalationSessionReuseRate),
    );
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

  return { passed: checks.every((c) => c.passed), checks };
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

const formatIntervalCell = (ci: RateInterval): string =>
  `${ci.passes}/${ci.total} (${pct(ci.rate)}, 95% CI [${pct(ci.low)}, ${pct(ci.high)}])`;

const pctRow = (label: string, base: number, cand: number): [string, string, string, string] => [
  label,
  pct(base),
  pct(cand),
  signedPct((cand - base) * 100),
];

const buildMetricRows = (
  report: ABComparisonReport,
): ReadonlyArray<[string, string, string, string]> => [
  pctRow("Correctness", report.baseline.correctnessRate, report.candidate.correctnessRate),
  pctRow(
    "Bounded Delegation Recall",
    report.baseline.boundedDelegationRecall,
    report.candidate.boundedDelegationRecall,
  ),
  pctRow(
    "Inline Negative Precision",
    report.baseline.inlineNegativePrecision,
    report.candidate.inlineNegativePrecision,
  ),
  pctRow(
    "Structured Escalation Rate",
    report.baseline.structuredEscalationRate,
    report.candidate.structuredEscalationRate,
  ),
  pctRow(
    "Escalation Session Reuse",
    report.baseline.escalationSessionReuseRate,
    report.candidate.escalationSessionReuseRate,
  ),
  pctRow(
    "Verification Hygiene",
    report.baseline.verificationHygieneRate,
    report.candidate.verificationHygieneRate,
  ),
  [
    "Parent Peak Input Tokens",
    report.baseline.meanParentPeakInputTokens.toFixed(0),
    report.candidate.meanParentPeakInputTokens.toFixed(0),
    signedPct(report.delta.parentPeakInputTokensPct),
  ],
  pctRow(
    "Frontier Token Share",
    report.baseline.meanFrontierTokenShare,
    report.candidate.meanFrontierTokenShare,
  ),
  [
    "Regret-Adjusted Cost",
    report.baseline.meanRegretAdjustedCostUnits.toFixed(4),
    report.candidate.meanRegretAdjustedCostUnits.toFixed(4),
    signedPct(report.delta.regretAdjustedCostPct),
  ],
];

const buildIntervalLines = (report: ABComparisonReport): ReadonlyArray<string> => {
  if (report.trialsPerScenario <= 1) return [];
  const pairs: ReadonlyArray<[string, RateInterval, RateInterval]> = [
    ["Correctness", report.baseline.intervals.correctness, report.candidate.intervals.correctness],
    [
      "Bounded Delegation Recall",
      report.baseline.intervals.boundedDelegation,
      report.candidate.intervals.boundedDelegation,
    ],
    [
      "Inline Negative Precision",
      report.baseline.intervals.inlineNegative,
      report.candidate.intervals.inlineNegative,
    ],
    [
      "Structured Escalation Rate",
      report.baseline.intervals.structuredEscalation,
      report.candidate.intervals.structuredEscalation,
    ],
    [
      "Escalation Session Reuse",
      report.baseline.intervals.escalationSessionReuse,
      report.candidate.intervals.escalationSessionReuse,
    ],
  ];
  const active = pairs.filter(([, b, c]) => b.total > 0 || c.total > 0);
  if (active.length === 0) return [];
  return [
    "",
    "Pass-Rate Summary (Wilson 95% CI):",
    ...active.map(
      ([label, baseCI, candCI]) =>
        `- ${label}: baseline ${formatIntervalCell(baseCI)} | candidate ${formatIntervalCell(candCI)}`,
    ),
  ];
};

export const formatComparisonTable = (report: ABComparisonReport): string => {
  const lines: Array<string> = [
    `Delegation A/B Report (baseline=${report.baselineRef}, model=${report.orchestratorModel}, trials=${report.trialsPerScenario})`,
    "",
    "| Metric | Baseline | Candidate | Delta |",
    "| --- | ---: | ---: | ---: |",
    ...buildMetricRows(report).map(([m, b, c, d]) => `| ${m} | ${b} | ${c} | ${d} |`),
    ...buildIntervalLines(report),
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
