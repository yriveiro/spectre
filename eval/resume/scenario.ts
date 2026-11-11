/**
 * A resume scenario is a small, scripted conversation. The fixture is the source
 * of truth for what the model does and what the harness expects. The golden is
 * the normalized observation from one run, so a change in the tool-call shape is
 * reviewable and a re-run is stable.
 *
 * The mock script is a fixture, not a golden. It stands in for a model that
 * follows the skill: the first turn delegates, the second continues the child.
 * A live model run uses the same prompts and expectations with the script
 * ignored.
 */

export type MockStep = {
  /** Which side of the subagent boundary answers. The system prompt decides. */
  readonly role: "parent" | "child";
  /** A substring of the last user message. The first matching step wins. */
  readonly when: string;
  /** A tool call, or a text reply when `tool` is absent. */
  readonly tool?: string;
  readonly input?: Readonly<Record<string, unknown>>;
  readonly text?: string;
};

export type Scenario = {
  readonly id: string;
  readonly description: string;
  readonly setup: Readonly<Record<string, string>>;
  readonly turns: ReadonlyArray<{ readonly prompt: string }>;
  readonly mock: ReadonlyArray<MockStep>;
  readonly expect: {
    readonly subagentCalls: number;
    /** True when call 2 continues call 1's child. False when it starts a new one. */
    readonly continuesFirstChild: boolean;
    readonly childSessions: number;
    readonly files: Readonly<Record<string, string>>;
  };
};

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const string = (value: unknown, path: string): string => {
  if (typeof value !== "string" || value === "") throw new Error(`${path}: expected a non-empty string`);
  return value;
};

const number = (value: unknown, path: string): number => {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0)
    throw new Error(`${path}: expected a non-negative integer`);
  return value;
};

const strings = (value: unknown, path: string): Readonly<Record<string, string>> => {
  if (!record(value)) throw new Error(`${path}: expected an object of strings`);
  return Object.fromEntries(
    Object.entries(value).map(([key, one]) => [key, string(one, `${path}.${key}`)]),
  );
};

export const parseScenario = (raw: unknown, path: string): Scenario => {
  if (!record(raw)) throw new Error(`${path}: expected an object`);
  if (!Array.isArray(raw.turns) || raw.turns.length === 0)
    throw new Error(`${path}.turns: expected at least one turn`);
  if (!Array.isArray(raw.mock) || raw.mock.length === 0)
    throw new Error(`${path}.mock: expected at least one step`);
  if (!record(raw.expect)) throw new Error(`${path}.expect: expected an object`);

  const turns = raw.turns.map((one, index) => {
    if (!record(one)) throw new Error(`${path}.turns[${index}]: expected an object`);
    return { prompt: string(one.prompt, `${path}.turns[${index}].prompt`) };
  });

  const mock = raw.mock.map((one, index): MockStep => {
    const at = `${path}.mock[${index}]`;
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

  const expect = raw.expect;
  return {
    id: string(raw.id, `${path}.id`),
    description: string(raw.description, `${path}.description`),
    setup: raw.setup === undefined ? {} : strings(raw.setup, `${path}.setup`),
    turns,
    mock,
    expect: {
      subagentCalls: number(expect.subagentCalls, `${path}.expect.subagentCalls`),
      continuesFirstChild:
        expect.continuesFirstChild === true
          ? true
          : expect.continuesFirstChild === false
            ? false
            : (() => {
                throw new Error(`${path}.expect.continuesFirstChild: expected a boolean`);
              })(),
      childSessions: number(expect.childSessions, `${path}.expect.childSessions`),
      files: strings(expect.files, `${path}.expect.files`),
    },
  };
};

export const loadScenario = async (path: string): Promise<Scenario> =>
  parseScenario(await Bun.file(path).json(), path);

export const listScenarios = async (): Promise<ReadonlyArray<Scenario>> => {
  const dir = `${import.meta.dir}/scenarios`;
  const files = [...new Bun.Glob("*.json").scanSync(dir)].toSorted();
  if (files.length === 0) throw new Error(`${dir}: no scenario fixtures`);
  return Promise.all(files.map((file) => loadScenario(`${dir}/${file}`)));
};

export const findScenario = async (id: string): Promise<Scenario> => {
  const all = await listScenarios();
  const one = all.find((scenario) => scenario.id === id);
  if (one === undefined)
    throw new Error(`no scenario "${id}". Known: ${all.map((scenario) => scenario.id).join(", ")}`);
  return one;
};
