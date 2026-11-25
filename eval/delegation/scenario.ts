import type { MockStep, WorkspacePath } from "../resume/scenario";

export type ScenarioSlice = "bounded-delegate" | "worker-escalate" | "inline-negative";

export type ExpectedEscalation = {
  readonly reason: "AMBIGUITY" | "SCOPE" | "FAILURE_CAP";
  readonly mustPreserveCleanFiles?: ReadonlyArray<WorkspacePath>;
  readonly resolution: "same-session-keep-model" | "same-session-upgrade-model";
};

export interface DelegationScenario {
  readonly id: string;
  readonly slice: ScenarioSlice;
  readonly description: string;
  readonly setup: Readonly<Record<WorkspacePath, string>>;
  readonly spectreConfig: {
    readonly models: Readonly<Record<string, string>>;
    readonly priority: ReadonlyArray<string>;
    readonly crosscheck?: ReadonlyArray<string>;
  };
  readonly turns: ReadonlyArray<{ readonly prompt: string }>;
  readonly mock?: ReadonlyArray<MockStep>;
  readonly verifyCommand?: string;
  readonly expect: {
    readonly expectedFiles?: Readonly<Record<WorkspacePath, string>>;
    readonly allowedMutatedFiles?: ReadonlyArray<WorkspacePath>;
    readonly requiredAnswerSubstrings?: ReadonlyArray<string>;
    readonly expectOperatorDelegation: boolean;
    readonly allowedProfiles?: ReadonlyArray<string>;
    readonly escalation?: ExpectedEscalation;
    readonly maxWorkerTurnsBeforeStop?: number;
  };
}

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SLICES: ReadonlySet<ScenarioSlice> = new Set([
  "bounded-delegate",
  "worker-escalate",
  "inline-negative",
]);
const REASONS: ReadonlySet<ExpectedEscalation["reason"]> = new Set([
  "AMBIGUITY",
  "SCOPE",
  "FAILURE_CAP",
]);
const RESOLUTIONS: ReadonlySet<ExpectedEscalation["resolution"]> = new Set([
  "same-session-keep-model",
  "same-session-upgrade-model",
]);

export const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const string = (value: unknown, path: string): string => {
  if (typeof value !== "string" || value === "")
    throw new Error(`${path}: expected a non-empty string`);
  return value;
};

const listOf = <T>(
  value: unknown,
  path: string,
  parseItem: (item: unknown, at: string) => T,
): ReadonlyArray<T> => {
  if (!Array.isArray(value)) throw new Error(`${path}: expected an array`);
  return value.map((item, index) => parseItem(item, `${path}[${index}]`));
};

const stringArray = (value: unknown, path: string): ReadonlyArray<string> =>
  listOf(value, path, string);

export const workspacePath = (value: unknown, path: string): WorkspacePath => {
  const text = string(value, path);
  if (text.includes("\0")) throw new Error(`${path}: expected a path without a NUL byte`);
  if (text.includes("\\")) throw new Error(`${path}: expected forward slashes only`);
  if (text.startsWith("/") || /^[A-Za-z]:/.test(text))
    throw new Error(`${path}: expected a path relative to the workspace`);
  const parts = text.split("/");
  if (parts.some((part) => part === "" || part === "." || part === ".."))
    throw new Error(`${path}: expected a normalized path inside the workspace`);
  return text as WorkspacePath;
};

const workspacePaths = (value: unknown, path: string): Readonly<Record<WorkspacePath, string>> => {
  if (!record(value)) throw new Error(`${path}: expected an object of strings`);
  return Object.fromEntries(
    Object.entries(value).map(([key, one]) => {
      const at = `${path}.${key}`;
      return [workspacePath(key, at), string(one, at)];
    }),
  ) as Readonly<Record<WorkspacePath, string>>;
};

const parseMock = (value: unknown, path: string): ReadonlyArray<MockStep> =>
  listOf(value, path, (one, at): MockStep => {
    if (!record(one)) throw new Error(`${at}: expected an object`);
    if (one.role !== "parent" && one.role !== "child")
      throw new Error(`${at}.role: expected "parent" or "child"`);
    if (one.tool !== undefined && typeof one.tool !== "string")
      throw new Error(`${at}.tool: expected a string`);
    if (one.input !== undefined && !record(one.input))
      throw new Error(`${at}.input: expected an object`);
    if (one.text !== undefined && typeof one.text !== "string")
      throw new Error(`${at}.text: expected a string`);
    if (one.tool === undefined && one.text === undefined)
      throw new Error(`${at}: expected a tool call or a text`);
    return {
      role: one.role,
      when: string(one.when, `${at}.when`),
      tool: one.tool,
      input: one.input as Readonly<Record<string, unknown>> | undefined,
      text: one.text,
    };
  });

const parseEscalation = (value: unknown, path: string): ExpectedEscalation => {
  if (!record(value)) throw new Error(`${path}: expected an object`);
  const reason = string(value.reason, `${path}.reason`) as ExpectedEscalation["reason"];
  if (!REASONS.has(reason))
    throw new Error(`${path}.reason: expected AMBIGUITY, SCOPE, or FAILURE_CAP`);
  const resolution = string(
    value.resolution,
    `${path}.resolution`,
  ) as ExpectedEscalation["resolution"];
  if (!RESOLUTIONS.has(resolution))
    throw new Error(
      `${path}.resolution: expected same-session-keep-model or same-session-upgrade-model`,
    );

  const mustPreserveCleanFiles =
    value.mustPreserveCleanFiles === undefined
      ? undefined
      : listOf(value.mustPreserveCleanFiles, `${path}.mustPreserveCleanFiles`, workspacePath);

  return {
    reason,
    ...(mustPreserveCleanFiles === undefined ? {} : { mustPreserveCleanFiles }),
    resolution,
  };
};

const parseSpectreConfig = (raw: unknown, path: string): DelegationScenario["spectreConfig"] => {
  if (!record(raw)) throw new Error(`${path}: expected an object`);
  if (!record(raw.models)) throw new Error(`${path}.models: expected an object`);
  const models = Object.fromEntries(
    Object.entries(raw.models).map(([alias, ref]) => [
      string(alias, `${path}.models.${alias}`),
      string(ref, `${path}.models.${alias}`),
    ]),
  );
  const priority = stringArray(raw.priority, `${path}.priority`);
  const crosscheck =
    raw.crosscheck === undefined ? undefined : stringArray(raw.crosscheck, `${path}.crosscheck`);
  return {
    models,
    priority,
    ...(crosscheck === undefined ? {} : { crosscheck }),
  };
};

const parseExpect = (raw: unknown, path: string): DelegationScenario["expect"] => {
  if (!record(raw)) throw new Error(`${path}: expected an object`);
  if (typeof raw.expectOperatorDelegation !== "boolean") {
    throw new Error(`${path}.expectOperatorDelegation: expected a boolean`);
  }
  const maxTurns = raw.maxWorkerTurnsBeforeStop;
  if (
    maxTurns !== undefined &&
    (typeof maxTurns !== "number" || !Number.isInteger(maxTurns) || maxTurns <= 0)
  ) {
    throw new Error(`${path}.maxWorkerTurnsBeforeStop: expected a positive integer`);
  }
  return {
    ...(raw.expectedFiles === undefined
      ? {}
      : { expectedFiles: workspacePaths(raw.expectedFiles, `${path}.expectedFiles`) }),
    ...(raw.allowedMutatedFiles === undefined
      ? {}
      : {
          allowedMutatedFiles: listOf(
            raw.allowedMutatedFiles,
            `${path}.allowedMutatedFiles`,
            workspacePath,
          ),
        }),
    ...(raw.requiredAnswerSubstrings === undefined
      ? {}
      : {
          requiredAnswerSubstrings: stringArray(
            raw.requiredAnswerSubstrings,
            `${path}.requiredAnswerSubstrings`,
          ),
        }),
    expectOperatorDelegation: raw.expectOperatorDelegation,
    ...(raw.allowedProfiles === undefined
      ? {}
      : { allowedProfiles: stringArray(raw.allowedProfiles, `${path}.allowedProfiles`) }),
    ...(raw.escalation === undefined
      ? {}
      : { escalation: parseEscalation(raw.escalation, `${path}.escalation`) }),
    ...(maxTurns === undefined ? {} : { maxWorkerTurnsBeforeStop: maxTurns }),
  };
};

export const parseScenario = (raw: unknown, path: string): DelegationScenario => {
  if (!record(raw)) throw new Error(`${path}: expected an object`);

  const id = string(raw.id, `${path}.id`);
  if (!ID.test(id)) throw new Error(`${path}.id: expected a lowercase slug of 1-64 characters`);

  const slice = string(raw.slice, `${path}.slice`) as ScenarioSlice;
  if (!SLICES.has(slice))
    throw new Error(
      `${path}.slice: expected bounded-delegate, worker-escalate, or inline-negative`,
    );

  if (!Array.isArray(raw.turns) || raw.turns.length === 0)
    throw new Error(`${path}.turns: expected at least one turn`);
  const turns = raw.turns.map((one, index) => {
    if (!record(one)) throw new Error(`${path}.turns[${index}]: expected an object`);
    return { prompt: string(one.prompt, `${path}.turns[${index}].prompt`) };
  });

  return {
    id,
    slice,
    description: string(raw.description, `${path}.description`),
    setup: raw.setup === undefined ? {} : workspacePaths(raw.setup, `${path}.setup`),
    spectreConfig: parseSpectreConfig(raw.spectreConfig, `${path}.spectreConfig`),
    turns,
    ...(raw.mock === undefined ? {} : { mock: parseMock(raw.mock, `${path}.mock`) }),
    ...(raw.verifyCommand === undefined
      ? {}
      : { verifyCommand: string(raw.verifyCommand, `${path}.verifyCommand`) }),
    expect: parseExpect(raw.expect, `${path}.expect`),
  };
};

export const loadScenario = async (path: string): Promise<DelegationScenario> =>
  parseScenario(await Bun.file(path).json(), path);

export const listScenarios = async (
  dir = `${import.meta.dir}/scenarios`,
): Promise<ReadonlyArray<DelegationScenario>> => {
  const files = [...new Bun.Glob("*.json").scanSync(dir)].toSorted();
  if (files.length === 0) throw new Error(`${dir}: no scenario fixtures`);
  return Promise.all(files.map((file) => loadScenario(`${dir}/${file}`)));
};

export const selectScenarios = async (
  ids: ReadonlyArray<string> | undefined,
  dir = `${import.meta.dir}/scenarios`,
): Promise<ReadonlyArray<DelegationScenario>> => {
  const all = await listScenarios(dir);
  if (ids === undefined || ids.length === 0) return all;
  const byId = new Map(all.map((one) => [one.id, one]));
  return ids.map((id) => {
    const found = byId.get(id);
    if (found === undefined)
      throw new Error(
        `no scenario "${id}". Known: ${all.map((scenario) => scenario.id).join(", ")}`,
      );
    return found;
  });
};
