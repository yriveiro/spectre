import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { type Definition, definitions } from "../../skills/definitions";
import { preparePlugin } from "../resume/plugin";

export type AblationArm = "present" | "stripped" | "replicate";

export interface ExactSetCheck {
  readonly ok: boolean;
  readonly label: string;
  readonly actualCount: number;
  readonly expectedCount: number;
  readonly duplicates: ReadonlyArray<string>;
  readonly missing: ReadonlyArray<string>;
  readonly extra: ReadonlyArray<string>;
  readonly findings: ReadonlyArray<string>;
}

export interface StagedEditRecord {
  readonly file: string;
  readonly label: string;
}

export interface StagedPluginArm {
  readonly arm: AblationArm;
  readonly targetSkill: string;
  readonly bundleDir: string;
  readonly pluginDir: string;
  readonly sourceSkillCount: number;
  readonly expectedIds: ReadonlyArray<string>;
  readonly strippedIds: ReadonlyArray<string>;
  readonly edits: ReadonlyArray<StagedEditRecord>;
}

export interface LeakageHit {
  readonly surface: string;
  readonly location: string;
  readonly pattern: string;
  readonly snippet: string;
}

export interface StagedAuditResult {
  readonly ok: boolean;
  readonly exactSet: ExactSetCheck;
  readonly toolListExactSet: ExactSetCheck;
  readonly catalogTokenCount: number;
  readonly catalogTokenCap: number;
  readonly inspectStatus: string;
  readonly searchContainsTarget: boolean;
  readonly schemaClean: boolean;
  readonly leaks: ReadonlyArray<LeakageHit>;
  readonly findings: ReadonlyArray<string>;
}

export const sourceSkillIds = (): ReadonlyArray<string> =>
  definitions.map((definition) => definition.id as string).toSorted();

export const assertExactSkillSet = (
  actual: ReadonlyArray<string>,
  expected: ReadonlyArray<string>,
  label: string,
): ExactSetCheck => {
  const counts = new Map<string, number>();
  for (const id of actual) {
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const duplicates = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([id]) => id)
    .toSorted();

  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  const missing = expected.filter((id) => !actualSet.has(id)).toSorted();
  const extra = [...actualSet].filter((id) => !expectedSet.has(id)).toSorted();

  const findings: Array<string> = [];
  if (duplicates.length > 0) {
    findings.push(`${label}: duplicate skill ids: ${duplicates.join(", ")}`);
  }
  if (missing.length > 0) {
    findings.push(`${label}: missing expected skill ids: ${missing.join(", ")}`);
  }
  if (extra.length > 0) {
    findings.push(`${label}: unexpected extra skill ids: ${extra.join(", ")}`);
  }

  return {
    ok: findings.length === 0,
    label,
    actualCount: actual.length,
    expectedCount: expected.length,
    duplicates,
    missing,
    extra,
    findings,
  };
};

interface TierCounts {
  readonly total: number;
  readonly push: number;
  readonly hub: number;
  readonly pull: number;
  readonly playbooks: number;
  readonly domainPull: number;
}

const countTiers = (items: ReadonlyArray<Definition>): TierCounts => ({
  total: items.length,
  push: items.filter((item) => item.catalog.tier === "push").length,
  hub: items.filter((item) => item.catalog.tier === "hub").length,
  pull: items.filter((item) => item.catalog.tier === "pull").length,
  playbooks: items.filter(
    (item) => item.catalog.tier === "pull" && item.catalog.category === "playbook",
  ).length,
  domainPull: items.filter(
    (item) => item.catalog.tier === "pull" && item.catalog.category !== "playbook",
  ).length,
});

const replaceExactAnchor = async (
  pluginDir: string,
  relPath: string,
  anchor: string,
  replacement: string,
  label: string,
  edits: Array<StagedEditRecord>,
): Promise<void> => {
  const fullPath = join(pluginDir, relPath);
  const current = await Bun.file(fullPath).text();
  const first = current.indexOf(anchor);
  if (first === -1) {
    throw new Error(`staged edit anchor missing in ${relPath} (${label})`);
  }
  if (current.indexOf(anchor, first + 1) !== -1) {
    throw new Error(`staged edit anchor matched multiple times in ${relPath} (${label})`);
  }
  const updated = `${current.slice(0, first)}${replacement}${current.slice(first + anchor.length)}`;
  await Bun.write(fullPath, updated);
  edits.push({ file: relPath, label });
};

const applyTddStripEdits = async (
  pluginDir: string,
  edits: Array<StagedEditRecord>,
): Promise<void> => {
  const sourceCounts = countTiers(definitions);
  const strippedCounts = countTiers(definitions.filter((item) => item.id !== "tdd"));

  const skillMdPath = join(pluginDir, "skills/definitions/tdd/SKILL.md");
  if (!(await Bun.file(skillMdPath).exists())) {
    throw new Error(`expected staged file missing: skills/definitions/tdd/SKILL.md`);
  }
  await rm(skillMdPath);
  edits.push({ file: "skills/definitions/tdd/SKILL.md", label: "delete target SKILL.md" });

  await replaceExactAnchor(
    pluginDir,
    "skills/definitions/index.ts",
    "];\n\nexport {",
    '].filter((definition) => definition.id !== "tdd");\n\nexport {',
    "filter tdd from definitions registry",
    edits,
  );

  await replaceExactAnchor(
    pluginDir,
    "skills/catalog.ts",
    '    "- Bug fix or defect with a local test target → `playbook-bug-fix` + `tdd` (failing test before production edit).",',
    '    "- Bug fix or defect with a local test target → `playbook-bug-fix`.",',
    "remove tdd SDLC gate cue from catalog",
    edits,
  );

  await replaceExactAnchor(
    pluginDir,
    "skills/catalog.ts",
    '    "- `verification`: failing-test-first (`tdd`), impact checks (`blast-radius`), app verification (`create-verification-skill`, `maintain-verification-skill`).",',
    '    "- `verification`: impact checks (`blast-radius`), app verification (`create-verification-skill`, `maintain-verification-skill`).",',
    "remove tdd verification bullet from catalog",
    edits,
  );

  await replaceExactAnchor(
    pluginDir,
    "skills/definitions/playbook/SKILL.md",
    [
      "Three questions force a choice over a bare request:",
      "",
      "1. **Is anything wrong?** Reproduce before you change anything. Load `playbook-bug-fix`.",
      "2. **Is it too slow?** Measure before you change anything. Load `playbook-perf-issue`.",
      "3. **Does a defect have a cheap local test target?** Write the failing test first with `tdd`.",
    ].join("\n"),
    [
      "Two questions force a choice over a bare request:",
      "",
      "1. **Is anything wrong?** Reproduce before you change anything. Load `playbook-bug-fix`.",
      "2. **Is it too slow?** Measure before you change anything. Load `playbook-perf-issue`.",
    ].join("\n"),
    "remove tdd question from playbook hub",
    edits,
  );

  await replaceExactAnchor(
    pluginDir,
    "skills/definitions/playbook-bug-fix/SKILL.md",
    [
      "`tdd` owns the order of operations once a failing test exists: the run comes",
      "first, before any production edit. This owns the shape of the whole task, and",
      "that test is one phase of it rather than the whole of it. Load `tdd` for the",
      "failing-test cadence, this for the hunt, the fix and the proof.",
      "",
      "",
    ].join("\n"),
    "",
    "remove tdd overview paragraph from playbook-bug-fix body",
    edits,
  );

  await replaceExactAnchor(
    pluginDir,
    "skills/definitions/playbook-bug-fix/SKILL.md",
    [
      "Unit tests show branch behaviour, not the absence of the bug. Where the defect",
      "has a cheap local test path, load `tdd` here: the failing run lands in git",
      "before the fix, and the fix is the commit that turns it green. Where the test",
      "would be expensive, integration-heavy or unclear, say which of those it was. A",
      "skipped step with a stated reason is a decision. A skipped step with no reason is",
      "a hole.",
    ].join("\n"),
    [
      "Unit tests show branch behaviour, not the absence of the bug. Add or update unit",
      "checks where practical, and report what you ran.",
    ].join("\n"),
    "remove tdd Phase D cue from playbook-bug-fix body",
    edits,
  );

  await replaceExactAnchor(
    pluginDir,
    "skills/definitions/playbook-bug-fix/index.ts",
    " `tdd` owns the order of operations once a failing test exists; this owns the hunt, the fix and the proof, and that test is one phase of it.",
    "",
    "remove tdd cue from playbook-bug-fix description",
    edits,
  );

  await replaceExactAnchor(
    pluginDir,
    "skills/definitions/playbook-session-pickup/SKILL.md",
    "`playbook-hillclimb` for a measured target with iterations left, a bug fix for one\ndefect, `tdd` for a change with untested behaviour.",
    "`playbook-hillclimb` for a measured target with iterations left, or a bug fix for one\ndefect.",
    "remove tdd cue from playbook-session-pickup body",
    edits,
  );

  await replaceExactAnchor(
    pluginDir,
    "skills/definitions/principle-test-for-truth/SKILL.md",
    "`principle-verification` owns the rule and `tdd` owns the\norder. This leaf owns the list of suite-level moves.",
    "`principle-verification` owns the rule. This leaf owns the list of suite-level moves.",
    "remove tdd cue from principle-test-for-truth body",
    edits,
  );

  await replaceExactAnchor(
    pluginDir,
    "tools/definitions/skills/index.ts",
    '      "Exact skill id, such as `playbook-bug-fix`, `opencode-platform`, or `pr-canvas`.",',
    '      "Exact skill id to inspect.",',
    "remove starter examples from skills InspectInput.id",
    edits,
  );

  await replaceExactAnchor(
    pluginDir,
    "tools/definitions/skills/index.ts",
    `      "Restrict search to \`push\` (${sourceCounts.push}), \`hub\` (${sourceCounts.hub}), or \`pull\` (${sourceCounts.pull}). Searches all ${sourceCounts.total} skills when omitted.",`,
    `      "Restrict search to \`push\` (${strippedCounts.push}), \`hub\` (${strippedCounts.hub}), or \`pull\` (${strippedCounts.pull}). Searches all ${strippedCounts.total} skills when omitted.",`,
    "update skills SearchInput.tier counts",
    edits,
  );

  await replaceExactAnchor(
    pluginDir,
    "tools/definitions/skills/index.ts",
    `      "Which tier to list. Defaults to \`pull\` (the ${sourceCounts.playbooks} playbooks and ${sourceCounts.domainPull} domain/workflow skills not pushed inline).",`,
    `      "Which tier to list. Defaults to \`pull\` (the ${strippedCounts.playbooks} playbooks and ${strippedCounts.domainPull} domain/workflow skills not pushed inline).",`,
    "update skills ListInput.tier counts",
    edits,
  );

  await replaceExactAnchor(
    pluginDir,
    "tools/definitions/skills/index.ts",
    `Ranks all ${sourceCounts.total} skill definitions by BM25`,
    `Ranks all ${strippedCounts.total} skill definitions by BM25`,
    "update skills DESCRIPTION count",
    edits,
  );
};

export const stagePluginArm = async (input: {
  readonly baseDir: string;
  readonly arm: AblationArm;
  readonly targetSkill: string;
}): Promise<StagedPluginArm> => {
  const target = definitions.find((item) => item.id === input.targetSkill);
  if (target === undefined) {
    throw new Error(`unknown targetSkill "${input.targetSkill}"`);
  }
  if (input.arm === "stripped") {
    if (target.catalog.tier === "hub") {
      throw new Error(`hub stripping is forbidden in v1 ("${input.targetSkill}")`);
    }
    if (input.targetSkill !== "tdd") {
      throw new Error(
        `v1 stripping only supports audited target "tdd" (received "${input.targetSkill}")`,
      );
    }
  }

  const allIds = sourceSkillIds();
  const bundleDir = join(input.baseDir, `bundle-${crypto.randomUUID().slice(0, 8)}`);
  await mkdir(bundleDir, { recursive: true });
  const pluginDir = await preparePlugin(bundleDir, "live");

  const edits: Array<StagedEditRecord> = [];
  if (input.arm === "stripped") {
    await applyTddStripEdits(pluginDir, edits);
  }

  const strippedIds = input.arm === "stripped" ? [input.targetSkill] : [];
  const expectedIds =
    input.arm === "stripped" ? allIds.filter((id) => id !== input.targetSkill) : allIds;

  return {
    arm: input.arm,
    targetSkill: input.targetSkill,
    bundleDir,
    pluginDir,
    sourceSkillCount: allIds.length,
    expectedIds,
    strippedIds,
    edits,
  };
};

export const auditStagedPlugin = async (staged: StagedPluginArm): Promise<StagedAuditResult> => {
  const probePath = join(import.meta.dir, "stage-probe.ts");
  const payload = JSON.stringify({
    pluginDir: staged.pluginDir,
    arm: staged.arm,
    targetSkill: staged.targetSkill,
    sourceSkillCount: staged.sourceSkillCount,
    expectedIds: staged.expectedIds,
    strippedIds: staged.strippedIds,
  });

  const proc = Bun.spawn([process.execPath, "run", probePath, payload], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(`staged plugin probe failed (exit ${exitCode}):\n${stderr || stdout}`);
  }

  return JSON.parse(stdout) as StagedAuditResult;
};
