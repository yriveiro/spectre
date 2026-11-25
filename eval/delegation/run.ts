import { defaultLiveModel, runLiveAB } from "./ab";
import { type DelegationScenario, selectScenarios } from "./scenario";
import { compareArms, formatComparisonTable, scoreTrial, type TrialObservation } from "./score";

const flagMap = new Map<string, string>();
const boolFlags = new Set<string>();
for (const arg of Bun.argv.slice(2)) {
  if (!arg.startsWith("--")) continue;
  const eq = arg.indexOf("=");
  if (eq === -1) boolFlags.add(arg.slice(2));
  else flagMap.set(arg.slice(2, eq), arg.slice(eq + 1));
}

const LIVE = boolFlags.has("live");
const KEEP = boolFlags.has("keep");
const BASELINE_REF = flagMap.get("baseline-ref") ?? "main";
const rawTrials = flagMap.get("trials") ?? "1";
const TRIALS = Number(rawTrials);
const SCENARIO_FILTER = flagMap
  .get("scenarios")
  ?.split(",")
  .map((item) => item.trim())
  .filter((item) => item !== "");

if (!Number.isInteger(TRIALS) || TRIALS <= 0) {
  throw new Error(`--trials must be a positive integer, got "${rawTrials}"`);
}

const syntheticSelfTest = (scenarios: ReadonlyArray<DelegationScenario>): void => {
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

    const baseTrial = scoreTrial({
      scenario,
      arm: "baseline",
      trial: 1,
      verifyExitCode: 0,
      observed: {
        scenarioId: scenario.id,
        loadedModelRouter: false,
        routingCalls: 0,
        subagentCalls: [],
        operatorSpawns: 0,
        escalations: [],
        outOfScopeMutations: [],
        parentPeakInputTokens: scenario.slice === "bounded-delegate" ? 28000 : 6000,
        parentTotalTokens: scenario.slice === "bounded-delegate" ? 36000 : 8000,
        childTotalTokens: 0,
        frontierTokenShare: 1,
        catalogueCostUnits: scenario.slice === "bounded-delegate" ? 0.12 : 0.03,
        parentFinalText,
        parentFailed: false,
        workspaceFiles,
      },
    });
    baselineTrials.push(baseTrial);

    const isDelegate = scenario.slice === "bounded-delegate";
    const isTrap = scenario.slice === "worker-escalate";
    const candTrial = scoreTrial({
      scenario,
      arm: "candidate",
      trial: 1,
      verifyExitCode: 0,
      baselineCostUnits: baseTrial.catalogueCostUnits,
      observed: {
        scenarioId: scenario.id,
        loadedModelRouter: isDelegate || isTrap,
        routingCalls: isDelegate || isTrap ? 1 : 0,
        subagentCalls:
          isDelegate || isTrap
            ? [
                {
                  agent: "operator",
                  model: "opencode-go/minimax-m3.1-flash-free",
                  hasInputSessionID: false,
                  outputSessionID: `ses_${scenario.id}`,
                  switchedModelOnResume: false,
                  status: "completed",
                  outputText: "",
                },
                ...(isTrap
                  ? [
                      {
                        agent: "operator",
                        model:
                          scenario.expect.escalation?.resolution === "same-session-upgrade-model"
                            ? "opencode-go/kimi-k3"
                            : undefined,
                        hasInputSessionID: true,
                        inputSessionID: `ses_${scenario.id}`,
                        outputSessionID: `ses_${scenario.id}`,
                        switchedModelOnResume:
                          scenario.expect.escalation?.resolution === "same-session-upgrade-model",
                        status: "completed",
                        outputText: "",
                      },
                    ]
                  : []),
              ]
            : [],
        operatorSpawns: isDelegate || isTrap ? 1 : 0,
        escalations:
          isTrap && scenario.expect.escalation !== undefined
            ? [
                {
                  childSessionID: `ses_${scenario.id}`,
                  structured: true,
                  reason: scenario.expect.escalation.reason,
                  childAssistantTurns: 1,
                  continuedSameSession: true,
                  upgradedModel:
                    scenario.expect.escalation.resolution === "same-session-upgrade-model",
                },
              ]
            : [],
        outOfScopeMutations: [],
        parentPeakInputTokens: isDelegate || isTrap ? 9000 : 6000,
        parentTotalTokens: isDelegate || isTrap ? 11000 : 8000,
        childTotalTokens: isDelegate || isTrap ? 18000 : 0,
        frontierTokenShare: isDelegate || isTrap ? 11000 / 29000 : 1,
        catalogueCostUnits: isDelegate || isTrap ? 0.04 : 0.03,
        parentFinalText,
        parentFailed: false,
        workspaceFiles,
      },
    });
    candidateTrials.push(candTrial);
  }

  const report = compareArms({
    baselineRef: BASELINE_REF,
    orchestratorModel: "self-test/synthetic",
    trialsPerScenario: 1,
    scenarios,
    baselineTrials,
    candidateTrials,
  });

  console.log(formatComparisonTable(report));
  if (!report.gates.passed) process.exit(1);
};

const main = async () => {
  const scenarios = await selectScenarios(SCENARIO_FILTER);
  if (!LIVE) {
    syntheticSelfTest(scenarios);
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
    keep: KEEP,
  });

  console.log(`\n${formatComparisonTable(report)}\n\nArtifacts: ${runsDir}`);
  if (!report.gates.passed) process.exit(1);
};

await main();
