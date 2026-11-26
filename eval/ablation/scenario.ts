import { isAbsolute, resolve } from "node:path";
import { Schema } from "effect";
import { definitions } from "../../skills/definitions";
import type { WorkspacePath } from "../resume/scenario";

export const BLINDING_FORBIDDEN_WORDS = [
  "eval",
  "test",
  "judge",
  "experiment",
  "rubric",
  "score",
  "compare",
  "benchmark",
  "candidate",
  "arena",
  "ablation",
  "stripped",
  "replicate",
] as const;

export interface JudgeCriterion {
  readonly id: string;
  readonly description: string;
  readonly weight: number;
}

export interface OracleSpec {
  readonly path: WorkspacePath;
  readonly content: string;
  readonly command: string;
}

export interface AblationScenario {
  readonly id: string;
  readonly description: string;
  readonly targetSkill: string;
  readonly sessionTitle: string;
  readonly setup: Readonly<Record<WorkspacePath, string>>;
  readonly productionFiles: ReadonlyArray<WorkspacePath>;
  readonly testFiles: ReadonlyArray<WorkspacePath>;
  readonly allowedMutatedFiles: ReadonlyArray<WorkspacePath>;
  readonly testCommandRegex: string;
  readonly verifyCommand: string;
  readonly oracle: OracleSpec;
  readonly turns: ReadonlyArray<{ readonly prompt: string }>;
  readonly rubric: {
    readonly taskSummary: string;
    readonly criteria: ReadonlyArray<JudgeCriterion>;
  };
}

const WORKSPACE_ROOT = "/__spectre_ablation_workspace__";
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const KNOWN_SKILLS = new Set<string>(definitions.map((def) => def.id));

const NonEmptyText = Schema.String.check(Schema.isMinLength(1));

const RawScenarioSchema = Schema.Struct({
  id: NonEmptyText,
  description: NonEmptyText,
  targetSkill: NonEmptyText,
  sessionTitle: NonEmptyText,
  setup: Schema.Record(Schema.String, Schema.String),
  productionFiles: Schema.Array(NonEmptyText),
  testFiles: Schema.Array(NonEmptyText),
  allowedMutatedFiles: Schema.Array(NonEmptyText),
  testCommandRegex: NonEmptyText,
  verifyCommand: NonEmptyText,
  oracle: Schema.Struct({
    path: NonEmptyText,
    content: NonEmptyText,
    command: NonEmptyText,
  }),
  turns: Schema.Array(Schema.Struct({ prompt: NonEmptyText })),
  rubric: Schema.Struct({
    taskSummary: NonEmptyText,
    criteria: Schema.Array(
      Schema.Struct({
        id: NonEmptyText,
        description: NonEmptyText,
        weight: Schema.Number,
      }),
    ),
  }),
});

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const checkSafeRelativePath = (candidate: string, at: string): WorkspacePath => {
  const invalid =
    candidate.trim() === "" ||
    candidate.includes("\0") ||
    isAbsolute(candidate) ||
    candidate.split("/").includes("..") ||
    !resolve(WORKSPACE_ROOT, candidate).startsWith(`${WORKSPACE_ROOT}/`);
  if (invalid) {
    throw new Error(`${at}: "${candidate}" must stay relative inside the workspace`);
  }
  return candidate as WorkspacePath;
};

export const findBlindingLeaks = (
  text: string,
  targetSkill: string,
): ReadonlyArray<string> => {
  const hits: Array<string> = [];
  const patterns: ReadonlyArray<{ readonly token: string; readonly regex: RegExp }> = [
    ...BLINDING_FORBIDDEN_WORDS.map((word) => ({
      token: word,
      regex: new RegExp(`(?<![a-z0-9])${escapeRegex(word)}(?![a-z0-9])`, "i"),
    })),
    {
      token: targetSkill,
      regex: new RegExp(`(?<![a-z0-9-])${escapeRegex(targetSkill)}(?![a-z0-9-])`, "i"),
    },
  ];
  for (const { token, regex } of patterns) {
    if (regex.test(text)) hits.push(token);
  }
  return [...new Set(hits)];
};

const assertBlind = (text: string, targetSkill: string, at: string): void => {
  const leaks = findBlindingLeaks(text, targetSkill);
  if (leaks.length > 0) {
    throw new Error(`${at}: blinding leak detected (${leaks.join(", ")})`);
  }
};

const validateTrackedFiles = (input: {
  readonly files: ReadonlyArray<WorkspacePath>;
  readonly setup: Readonly<Record<WorkspacePath, string>>;
  readonly allowed: ReadonlySet<string>;
  readonly label: string;
}): void => {
  if (input.files.length === 0) throw new Error(`${input.label}: expected at least one file`);
  for (const file of input.files) {
    if (!(file in input.setup)) throw new Error(`${input.label}: "${file}" missing from setup`);
    if (!input.allowed.has(file)) {
      throw new Error(`${input.label}: "${file}" missing from allowedMutatedFiles`);
    }
  }
};

const normalizeCriteria = (
  criteria: ReadonlyArray<JudgeCriterion>,
  at: string,
): ReadonlyArray<JudgeCriterion> => {
  if (criteria.length === 0 || criteria.length > 6) {
    throw new Error(`${at}: expected 1 to 6 rubric criteria`);
  }
  const seen = new Set<string>();
  let total = 0;
  for (const [index, entry] of criteria.entries()) {
    if (seen.has(entry.id)) throw new Error(`${at}[${index}]: duplicate criterion "${entry.id}"`);
    seen.add(entry.id);
    if (!Number.isFinite(entry.weight) || entry.weight <= 0) {
      throw new Error(`${at}[${index}].weight: expected a finite positive weight`);
    }
    total += entry.weight;
  }
  return criteria.map((entry) => ({ ...entry, weight: entry.weight / total }));
};

export const parseScenario = (raw: unknown, path: string): AblationScenario => {
  const decoded = Schema.decodeUnknownSync(RawScenarioSchema)(raw);

  if (!SLUG.test(decoded.id)) {
    throw new Error(`${path}.id: expected a lowercase slug of 1-64 characters`);
  }
  if (!KNOWN_SKILLS.has(decoded.targetSkill)) {
    throw new Error(`${path}.targetSkill: unknown targetSkill "${decoded.targetSkill}"`);
  }
  assertBlind(decoded.sessionTitle, decoded.targetSkill, `${path}.sessionTitle`);

  const setupEntries = Object.entries(decoded.setup);
  if (setupEntries.length === 0) throw new Error(`${path}.setup: expected at least one setup file`);
  const setup = Object.fromEntries(
    setupEntries.map(([key, body]) => {
      const checked = checkSafeRelativePath(key, `${path}.setup.${key}`);
      assertBlind(checked, decoded.targetSkill, `${path}.setup.${key}`);
      return [checked, body];
    }),
  ) as Readonly<Record<WorkspacePath, string>>;

  const productionFiles = decoded.productionFiles.map((file, i) =>
    checkSafeRelativePath(file, `${path}.productionFiles[${i}]`),
  );
  const testFiles = decoded.testFiles.map((file, i) =>
    checkSafeRelativePath(file, `${path}.testFiles[${i}]`),
  );
  const allowedMutatedFiles = decoded.allowedMutatedFiles.map((file, i) =>
    checkSafeRelativePath(file, `${path}.allowedMutatedFiles[${i}]`),
  );
  const allowedSet = new Set<string>(allowedMutatedFiles);

  validateTrackedFiles({
    files: productionFiles,
    setup,
    allowed: allowedSet,
    label: `${path}.productionFiles`,
  });
  validateTrackedFiles({
    files: testFiles,
    setup,
    allowed: allowedSet,
    label: `${path}.testFiles`,
  });
  const testSet = new Set<string>(testFiles);
  for (const file of productionFiles) {
    if (testSet.has(file)) {
      throw new Error(`${path}.productionFiles: "${file}" cannot also be in testFiles`);
    }
  }

  try {
    new RegExp(decoded.testCommandRegex);
  } catch (cause) {
    throw new Error(
      `${path}.testCommandRegex: invalid regex (${cause instanceof Error ? cause.message : String(cause)})`,
    );
  }

  const oraclePath = checkSafeRelativePath(decoded.oracle.path, `${path}.oracle.path`);
  if (oraclePath in setup) {
    throw new Error(`${path}.oracle.path: oracle file "${oraclePath}" must not exist in setup`);
  }

  if (decoded.turns.length === 0) throw new Error(`${path}.turns: expected at least one turn`);
  for (const [index, turn] of decoded.turns.entries()) {
    assertBlind(turn.prompt, decoded.targetSkill, `${path}.turns[${index}].prompt`);
  }

  assertBlind(decoded.rubric.taskSummary, decoded.targetSkill, `${path}.rubric.taskSummary`);
  const criteria = normalizeCriteria(decoded.rubric.criteria, `${path}.rubric.criteria`);

  return {
    id: decoded.id,
    description: decoded.description,
    targetSkill: decoded.targetSkill,
    sessionTitle: decoded.sessionTitle,
    setup,
    productionFiles,
    testFiles,
    allowedMutatedFiles,
    testCommandRegex: decoded.testCommandRegex,
    verifyCommand: decoded.verifyCommand,
    oracle: {
      path: oraclePath,
      content: decoded.oracle.content,
      command: decoded.oracle.command,
    },
    turns: decoded.turns,
    rubric: {
      taskSummary: decoded.rubric.taskSummary,
      criteria,
    },
  };
};

export const loadScenario = async (path: string): Promise<AblationScenario> =>
  parseScenario(await Bun.file(path).json(), path);

export const listScenarios = async (
  dir = `${import.meta.dir}/scenarios`,
): Promise<ReadonlyArray<AblationScenario>> => {
  const files = [...new Bun.Glob("*.json").scanSync(dir)].toSorted();
  if (files.length === 0) throw new Error(`${dir}: no scenario fixtures`);
  return Promise.all(files.map((file) => loadScenario(`${dir}/${file}`)));
};

export const selectScenarios = async (
  ids?: ReadonlyArray<string>,
  dir = `${import.meta.dir}/scenarios`,
): Promise<ReadonlyArray<AblationScenario>> => {
  const all = await listScenarios(dir);
  if (ids === undefined || ids.length === 0) return all;
  const byId = new Map(all.map((item) => [item.id, item]));
  return ids.map((id) => {
    const found = byId.get(id);
    if (found === undefined) {
      throw new Error(`unknown scenario "${id}". Known: ${all.map((item) => item.id).join(", ")}`);
    }
    return found;
  });
};
