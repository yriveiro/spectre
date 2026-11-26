import { defaultLiveModel, runLiveAB } from "./ab";
import type { EscalationObservation, SubagentCallObservation } from "./observe";
import { type DelegationScenario, selectScenarios } from "./scenario";
import { compareArms, formatComparisonTable, scoreTrial, type TrialObservation } from "./score";

const USAGE = `Usage: bun run eval:delegation -- (--live | --self-test) [options]

Modes (one required):
  --live                 Run live A/B delegation evaluation against OpenCode
  --self-test            Run deterministic synthetic harness self-test

Options:
  --trials=<n>           Trials per scenario (default: 3 in --live, 1 in --self-test)
  --baseline-ref=<ref>   Git ref for baseline arm (default: main)
  --model=<provider/id>  Orchestrator model ref
  --scenarios=<a,b,...>  Comma-separated scenario IDs to run
  --use-repo-config      Override scenario.spectreConfig with repo spectre.json
  --config=<path>        Override scenario.spectreConfig with explicit JSON file
  --keep                 Keep live server processes and trial workspaces`;

const flagMap = new Map<string, string>();
const boolFlags = new Set<string>();
for (const arg of Bun.argv.slice(2)) {
  if (!arg.startsWith("--")) continue;
  const eq = arg.indexOf("=");
  if (eq === -1) boolFlags.add(arg.slice(2));
  else flagMap.set(arg.slice(2, eq), arg.slice(eq + 1));
}

const LIVE = boolFlags.has("live");
const SELF_TEST = boolFlags.has("self-test");
if (LIVE === SELF_TEST) {
  console.error(USAGE);
  process.exit(1);
}

const KEEP = boolFlags.has("keep");
const USE_REPO_CONFIG = boolFlags.has("use-repo-config");
const CONFIG_PATH = flagMap.get("config");
const BASELINE_REF = flagMap.get("baseline-ref") ?? "main";
const rawTrials = flagMap.get("trials") ?? (LIVE ? "3" : "1");
const TRIALS = Number(rawTrials);
const SCENARIO_FILTER = flagMap
  .get("scenarios")
  ?.split(",")
  .map((item) => item.trim())
  .filter((item) => item !== "");

if (!Number.isInteger(TRIALS) || TRIALS <= 0) {
  throw new Error(`--trials must be a positive integer, got "${rawTrials}"`);
}

const WORKER_MODEL = "opencode-go/minimax-m3.1-flash-free";
const UPGRADED_MODEL = "opencode-go/kimi-k3";

const syntheticCallsFor = (
  scenario: DelegationScenario,
  sessionID: string,
): ReadonlyArray<SubagentCallObservation> => {
  if (scenario.slice === "inline-negative") return [];
  const spawn: SubagentCallObservation = {
    agent: "operator",
    model: WORKER_MODEL,
    hasInputSessionID: false,
    outputSessionID: sessionID,
    switchedModelOnResume: false,
    upgradedModelOnResume: false,
    status: "completed",
    outputText: "",
  };
  if (scenario.slice !== "worker-escalate") return [spawn];
  const upgrade = scenario.expect.escalation?.resolution === "same-session-upgrade-model";
  return [
    spawn,
    {
      agent: "operator",
      model: upgrade ? UPGRADED_MODEL : undefined,
      hasInputSessionID: true,
      inputSessionID: sessionID,
      outputSessionID: sessionID,
      switchedModelOnResume: upgrade,
      upgradedModelOnResume: upgrade,
      status: "completed",
      outputText: "",
    },
  ];
};

const syntheticEscalationsFor = (
  scenario: DelegationScenario,
  sessionID: string,
): ReadonlyArray<EscalationObservation> => {
  if (scenario.slice !== "worker-escalate" || scenario.expect.escalation === undefined) return [];
  const upgrade = scenario.expect.escalation.resolution === "same-session-upgrade-model";
  return [
    {
      childSessionID: sessionID,
      structured: true,
      reason: scenario.expect.escalation.reason,
      childAssistantTurns: 1,
      continuedSameSession: true,
      upgradedModel: upgrade,
      switchedModel: upgrade,
    },
  ];
};

const buildSyntheticBaseline = (
  scenario: DelegationScenario,
  trial: number,
  workspaceFiles: Readonly<Record<string, string>>,
  parentFinalText: string,
): TrialObservation => {
  const heavy = scenario.slice === "bounded-delegate";
  return scoreTrial({
    scenario,
    arm: "baseline",
    trial,
    verifyExitCode: 0,
    observed: {
      scenarioId: scenario.id,
      loadedModelRouter: false,
      routingCalls: 0,
      subagentCalls: [],
      operatorSpawns: 0,
      escalations: [],
      outOfScopeMutations: [],
      unexpectedFileMutations: [],
      verifiedAfterLastEdit: true,
      parentPeakInputTokens: heavy ? 28000 : 6000,
      parentTotalTokens: heavy ? 36000 : 8000,
      childTotalTokens: 0,
      frontierTokenShare: 1,
      catalogueCostUnits: heavy ? 0.12 : 0.03,
      parentFinalText,
      parentFailed: false,
      workspaceFiles,
    },
  });
};

const buildSyntheticCandidate = (
  scenario: DelegationScenario,
  trial: number,
  baselineCostUnits: number,
  workspaceFiles: Readonly<Record<string, string>>,
  parentFinalText: string,
): TrialObservation => {
  const delegates = scenario.slice !== "inline-negative";
  const upgrade = scenario.expect.escalation?.resolution === "same-session-upgrade-model";
  const primaryProfile = scenario.expect.allowedProfiles?.[0] ?? "worker";
  const sessionID = `ses_${scenario.id}_${trial}`;
  const profiles = delegates
    ? [
        { profile: primaryProfile, agent: "operator", modelRef: WORKER_MODEL },
        ...(upgrade ? [{ profile: "thinking", agent: "spectre", modelRef: UPGRADED_MODEL }] : []),
      ]
    : [];

  return scoreTrial({
    scenario,
    arm: "candidate",
    trial,
    verifyExitCode: 0,
    baselineCostUnits,
    observed: {
      scenarioId: scenario.id,
      loadedModelRouter: delegates,
      routingCalls: profiles.length,
      routedProfiles: profiles,
      subagentCalls: syntheticCallsFor(scenario, sessionID),
      operatorSpawns: delegates ? 1 : 0,
      escalations: syntheticEscalationsFor(scenario, sessionID),
      outOfScopeMutations: [],
      unexpectedFileMutations: [],
      verifiedAfterLastEdit: true,
      parentPeakInputTokens: delegates ? 9000 : 6000,
      parentTotalTokens: delegates ? 11000 : 8000,
      childTotalTokens: delegates ? 18000 : 0,
      frontierTokenShare: delegates ? 11000 / 29000 : 1,
      catalogueCostUnits: delegates ? 0.04 : 0.03,
      parentFinalText,
      parentFailed: false,
      workspaceFiles,
    },
  });
};

const syntheticSelfTest = (scenarios: ReadonlyArray<DelegationScenario>, trials: number): void => {
  const baselineTrials: Array<TrialObservation> = [];
  const candidateTrials: Array<TrialObservation> = [];

  for (const scenario of scenarios) {
    const cleanFiles = Object.fromEntries(
      Object.entries(scenario.expect.expectedFiles ?? {}).map(([k, v]) => [k, v.trimEnd()]),
    );
    const preserveFiles = Object.fromEntries(
      (scenario.expect.escalation?.mustPreserveCleanFiles ?? []).map((k) => [
        k,
        (scenario.setup[k] ?? "").trimEnd(),
      ]),
    );
    const workspaceFiles = { ...preserveFiles, ...cleanFiles };
    const parentFinalText = (scenario.expect.requiredAnswerSubstrings ?? []).join(" ");

    for (let trial = 1; trial <= trials; trial++) {
      const baseTrial = buildSyntheticBaseline(scenario, trial, workspaceFiles, parentFinalText);
      baselineTrials.push(baseTrial);
      candidateTrials.push(
        buildSyntheticCandidate(
          scenario,
          trial,
          baseTrial.catalogueCostUnits,
          workspaceFiles,
          parentFinalText,
        ),
      );
    }
  }

  const report = compareArms({
    baselineRef: BASELINE_REF,
    orchestratorModel: "self-test/synthetic",
    trialsPerScenario: trials,
    scenarios,
    baselineTrials,
    candidateTrials,
  });

  console.log(formatComparisonTable(report));
  if (!report.gates.passed) process.exit(1);
};

const main = async () => {
  const scenarios = await selectScenarios(SCENARIO_FILTER);
  if (SELF_TEST) {
    syntheticSelfTest(scenarios, TRIALS);
    return;
  }

  const model =
    flagMap.get("model") ?? Bun.env.SPECTRE_EVAL_LIVE_MODEL ?? (await defaultLiveModel());
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runsDir = `${import.meta.dir}/.runs/${stamp}`;

  const report = await runLiveAB({
    baselineRef: BASELINE_REF,
    model,
    trials: TRIALS,
    runsDir,
    scenarios,
    useRepoConfig: USE_REPO_CONFIG,
    ...(CONFIG_PATH === undefined ? {} : { configPath: CONFIG_PATH }),
    keep: KEEP,
  });

  console.log(`\n${formatComparisonTable(report)}\n\nArtifacts: ${runsDir}`);
  if (!report.gates.passed) process.exit(1);
};

await main();
