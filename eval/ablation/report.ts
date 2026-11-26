import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { AblationSummary, ArmSummary } from "./score";

export interface ReportMetadata {
  readonly mode: "live" | "self-test";
  readonly actorModel: string;
  readonly actorFamily?: string;
  readonly judgeModel?: string;
  readonly judgeFamily?: string;
  readonly sameFamilyOverride?: boolean;
  readonly runsDir?: string;
}

const fmtUsd = (value: number): string => `$${value.toFixed(4)}`;
const fmtCount = (count: number, total: number): string => `${count}/${total}`;
const fmtNum = (value: number, digits = 1): string => value.toFixed(digits);
const formatDelta = (value: number, digits = 1): string => {
  const fixed = Math.abs(value).toFixed(digits);
  return value < 0 ? `-${fixed}` : `+${fixed}`;
};

const armRow = (label: string, arm: ArmSummary): string =>
  `| ${label} | ${fmtCount(arm.completed, arm.scheduled)} | ${fmtCount(arm.activatedCount, arm.completed)} | ${fmtCount(arm.workspacePassCount, arm.completed)} | ${fmtCount(arm.causalRedBeforeEditCount, arm.completed)} | ${fmtNum(arm.meanToolErrors, 2)} | ${fmtNum(arm.meanAssistantTurns, 1)} | ${Math.round(arm.meanTotalTokens)} (r:${Math.round(arm.meanCacheReadTokens)}/w:${Math.round(arm.meanCacheWriteTokens)}) | ${fmtUsd(arm.meanHostRecordedUsd)} |`;

export const formatAblationReport = (
  summary: AblationSummary,
  metadata: ReportMetadata,
): string => {
  const lines: Array<string> = [
    "# Skill Ablation & Causal Trajectory Report",
    "",
    `- Mode: \`${metadata.mode}\` | Scenario: \`${summary.scenarioId}\` | Target skill: \`${summary.targetSkill}\``,
    `- Actor model: \`${metadata.actorModel}\`${metadata.actorFamily ? ` (family: \`${metadata.actorFamily}\`)` : ""}`,
    metadata.judgeModel === undefined
      ? "- Blind judge: disabled"
      : `- Blind judge: \`${metadata.judgeModel}\`${metadata.judgeFamily ? ` (family: \`${metadata.judgeFamily}\`)` : ""}${metadata.sameFamilyOverride ? " [SAME-FAMILY OVERRIDE]" : ""}`,
    `- Trials/arm: \`${summary.trialsPerArm}\` (signal threshold: \`>= ${summary.minPairsForSignal}\` complete pairs)`,
    `- Verdict: **${summary.verdict}** (${summary.verdictReasons.join(", ")})`,
    "",
    "## Arm Breakdown (Strict Metric Separation)",
    "",
    "| Arm | Completed | Target Activated | Workspace Pass | Causal Red-Before-Edit | Mean Tool Errors | Mean Turns | Mean Tokens (cache r/w) | Mean Host-Recorded USD |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    armRow("present (T)", summary.arms.present),
    armRow("stripped (A)", summary.arms.stripped),
    armRow("replicate (T')", summary.arms.replicate),
    "",
    "## Paired Counts (T vs A) & Descriptive A/A Noise Spread (T vs T')",
    "",
    `| Metric | Complete Pairs (T vs A) | T-only / A-only / Both / Neither | Net Δ (T−A) | A/A Spread (T vs T', ${summary.noiseAA.completePairs} pairs) |`,
    "| --- | ---: | --- | ---: | --- |",
    `| Workspace Pass | ${summary.pairedAB.workspacePass.completePairs} | ${summary.pairedAB.workspacePass.leftOnly} / ${summary.pairedAB.workspacePass.rightOnly} / ${summary.pairedAB.workspacePass.both} / ${summary.pairedAB.workspacePass.neither} | ${summary.pairedAB.workspacePass.netDeltaCount >= 0 ? "+" : ""}${summary.pairedAB.workspacePass.netDeltaCount} | ${summary.noiseAA.workspaceDisagreements} disagreements |`,
    `| Causal Red-Before-Edit | ${summary.pairedAB.causalRedBeforeEdit.completePairs} | ${summary.pairedAB.causalRedBeforeEdit.leftOnly} / ${summary.pairedAB.causalRedBeforeEdit.rightOnly} / ${summary.pairedAB.causalRedBeforeEdit.both} / ${summary.pairedAB.causalRedBeforeEdit.neither} | ${summary.pairedAB.causalRedBeforeEdit.netDeltaCount >= 0 ? "+" : ""}${summary.pairedAB.causalRedBeforeEdit.netDeltaCount} | ${summary.noiseAA.causalRedDisagreements} disagreements |`,
    `| Total Tokens | ${summary.pairedAB.workspacePass.completePairs} | mean Δ ${formatDelta(summary.pairedAB.meanTokenDelta, 0)} | — | max |Δ| ${Math.round(summary.noiseAA.maxAbsTokenDelta)} (mean ${Math.round(summary.noiseAA.meanAbsTokenDelta)}) |`,
    `| Assistant Turns | ${summary.pairedAB.workspacePass.completePairs} | mean Δ ${formatDelta(summary.pairedAB.meanTurnDelta, 2)} | — | max |Δ| ${fmtNum(summary.noiseAA.maxAbsTurnDelta, 1)} (mean ${fmtNum(summary.noiseAA.meanAbsTurnDelta, 2)}) |`,
    `| Tool Errors | ${summary.pairedAB.workspacePass.completePairs} | mean Δ ${formatDelta(summary.pairedAB.meanToolErrorDelta, 2)} | — | max |Δ| ${fmtNum(summary.noiseAA.maxAbsToolErrorDelta, 1)} (mean ${fmtNum(summary.noiseAA.meanAbsToolErrorDelta, 2)}) |`,
    `| Host-Recorded USD | ${summary.pairedAB.workspacePass.completePairs} | mean Δ ${summary.pairedAB.meanHostUsdDelta >= 0 ? "+" : "-"}${fmtUsd(Math.abs(summary.pairedAB.meanHostUsdDelta))} | — | max |Δ| ${fmtUsd(summary.noiseAA.maxAbsHostUsdDelta)} |`,
  ];

  if (summary.judge !== undefined) {
    lines.push(
      "",
      "## Blind Cross-Family Judge (Order-Swapped Pairwise)",
      "",
      "| Comparison | Pairs | Left Wins | Right Wins | Ties | Unresolved (Swap Disagreement) | Unparseable | Judge Host-Recorded USD |",
      "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
      `| present vs stripped (T vs A) | ${summary.judge.ab.totalPairs} | ${summary.judge.ab.left} | ${summary.judge.ab.right} | ${summary.judge.ab.tie} | ${summary.judge.ab.unresolved} | ${summary.judge.ab.unparseable} | ${fmtUsd(summary.judge.ab.totalHostRecordedUsd)} |`,
      `| present vs replicate (T vs T') | ${summary.judge.aa.totalPairs} | ${summary.judge.aa.left} | ${summary.judge.aa.right} | ${summary.judge.aa.tie} | ${summary.judge.aa.unresolved} | ${summary.judge.aa.unparseable} | ${fmtUsd(summary.judge.aa.totalHostRecordedUsd)} |`,
    );
  }

  lines.push(
    "",
    `## Validity Gates: ${summary.validity.allPassed ? "PASS" : "FAIL"}`,
    `- [${summary.validity.stagedAuditPassed ? "PASS" : "FAIL"}] staged_audit_passed`,
    `- [${summary.validity.hostRegistrationVerified ? "PASS" : "FAIL"}] host_registration_verified`,
    `- [${summary.validity.blindingVerified ? "PASS" : "FAIL"}] blinding_verified`,
    `- [${summary.validity.crossFamilyJudgeVerified ? "PASS" : "FAIL"}] cross_family_judge_verified`,
    `- [${summary.validity.zeroSystemicFailures ? "PASS" : "FAIL"}] zero_systemic_failures`,
  );

  if (metadata.runsDir !== undefined) {
    lines.push("", `Artifacts: ${metadata.runsDir}`);
  }

  return `${lines.join("\n")}\n`;
};

export const writeAblationArtifacts = async (input: {
  readonly runsDir: string;
  readonly summary: AblationSummary;
  readonly metadata: ReportMetadata;
  readonly payload: Readonly<Record<string, unknown>>;
}): Promise<{ readonly markdownPath: string; readonly jsonPath: string; readonly markdown: string }> => {
  await mkdir(input.runsDir, { recursive: true });
  const markdown = formatAblationReport(input.summary, {
    ...input.metadata,
    runsDir: input.runsDir,
  });
  const markdownPath = join(input.runsDir, "report.md");
  const jsonPath = join(input.runsDir, "report.json");
  await Bun.write(markdownPath, markdown);
  await Bun.write(jsonPath, `${JSON.stringify(input.payload, null, 2)}\n`);
  return { markdownPath, jsonPath, markdown };
};
