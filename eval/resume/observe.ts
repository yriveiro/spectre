import type { Message, Part } from "../opencode";
import type { Scenario, WorkspacePath } from "./scenario";
import { readIn } from "./workspace";

type ToolState = {
  readonly status?: string;
  readonly input?: Readonly<Record<string, unknown>>;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly content?: ReadonlyArray<{ readonly type?: string; readonly text?: string }>;
};

export type SubagentCall = {
  readonly agent?: string;
  readonly description?: string;
  readonly prompt?: string;
  /** The `sessionID` the caller passed. Absent on a fresh spawn. */
  readonly sessionID?: string;
  /** The id the host returned. Present on every completed call. */
  readonly outputSessionID?: string;
  readonly status?: string;
  /** The tool part's creation time, used to restore call order. */
  readonly at?: number;
};

export type Observed = {
  readonly scenario: string;
  readonly mode: "mock" | "live";
  readonly model: string;
  readonly calls: ReadonlyArray<{
    readonly agent?: string;
    readonly hasSessionID: boolean;
    readonly hasOutputSessionID: boolean;
    readonly continuesFirst: boolean;
    readonly status?: string;
  }>;
  readonly childSessions: number;
  readonly files: Readonly<Record<string, string>>;
};

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

/** The host writes the child id in `metadata.sessionID` and in the result text. */
const outputID = (state: ToolState | undefined): string | undefined => {
  const metadata = text(state?.metadata?.sessionID);
  if (metadata !== undefined) return metadata;
  for (const part of state?.content ?? []) {
    const match = part.text?.match(/sessionID="([^"]+)"/);
    if (match?.[1] !== undefined) return match[1];
  }
  return undefined;
};

/**
 * Every `subagent` tool part in the parent transcript, in message order. The
 * part shape is the host's: `name`, `state.input`, `state.metadata` and
 * `state.content`. It is read as a whole part, not through `Part.state.input`,
 * because the output lives beside the input.
 */
export const subagentCalls = (messages: ReadonlyArray<Message>): ReadonlyArray<SubagentCall> => {
  const calls: Array<{ readonly at: number; readonly order: number; readonly call: SubagentCall }> = [];
  let order = 0;
  for (const message of messages) {
    const messageAt = (message as { readonly time?: { readonly created?: number } }).time?.created ?? 0;
    for (const part of message.content ?? []) {
      if (part.type !== "tool" || part.name !== "subagent") continue;
      const state = (part as Part & { state?: ToolState }).state;
      const input = state?.input ?? {};
      const at = (part as { readonly time?: { readonly created?: number } }).time?.created ?? messageAt;
      calls.push({
        at,
        order: order++,
        call: {
          agent: text(input.agent),
          description: text(input.description),
          prompt: text(input.prompt),
          sessionID: text(input.sessionID),
          outputSessionID: outputID(state),
          status: text(state?.status),
          at,
        },
      });
    }
  }
  // The message list arrives newest-first. The part time puts the calls back in
  // the order the session made them, and the index breaks a same-millisecond tie.
  return calls.toSorted((a, b) => a.at - b.at || a.order - b.order).map((one) => one.call);
};

/**
 * Read the files the fixture names, trimmed at the end so a trailing newline is
 * not a finding. The path has already passed the fixture parser; `readIn`
 * resolves a symlink and refuses one that leaves the workspace.
 */
export const readFiles = async (
  workspace: string,
  expected: Readonly<Record<WorkspacePath, string>>,
): Promise<Readonly<Record<string, string>>> => {
  const files: Record<string, string> = {};
  for (const key of Object.keys(expected) as WorkspacePath[]) files[key] = await readIn(workspace, key);
  return files;
};

export const observed = (input: {
  readonly scenario: Scenario;
  readonly mode: "mock" | "live";
  readonly model: string;
  readonly calls: ReadonlyArray<SubagentCall>;
  readonly files: Readonly<Record<string, string>>;
}): Observed => {
  const first = input.calls[0]?.outputSessionID;
  const children = new Set(
    input.calls.flatMap((call) => (call.outputSessionID === undefined ? [] : [call.outputSessionID])),
  );
  return {
    scenario: input.scenario.id,
    mode: input.mode,
    model: input.model,
    calls: input.calls.map((call, index) => ({
      agent: call.agent,
      hasSessionID: call.sessionID !== undefined,
      hasOutputSessionID: call.outputSessionID !== undefined,
      continuesFirst:
        index > 0 && call.sessionID !== undefined && first !== undefined && call.sessionID === first,
      status: call.status,
    })),
    childSessions: children.size,
    files: input.files,
  };
};

const short = (value: string, limit = 80): string =>
  value.length <= limit ? value : `${value.slice(0, limit)}…`;

/** Every finding is a claim about the world, named with the call or the file it is about. */
export const assertScenario = (scenario: Scenario, run: Observed): ReadonlyArray<string> => {
  const findings: Array<string> = [];
  const { expect } = scenario;
  const calls = run.calls;

  if (calls.length !== expect.subagentCalls)
    findings.push(`subagent calls: expected ${expect.subagentCalls}, got ${calls.length}`);

  if (calls[0]?.hasOutputSessionID !== true)
    findings.push("call 1: the first subagent call returned no sessionID");

  if (expect.continuesFirstChild) {
    if (calls[1]?.hasSessionID !== true)
      findings.push("call 2: no input sessionID, so the parent spawned a new child");
    if (calls[1]?.continuesFirst !== true)
      findings.push("call 2: the input sessionID is not the first child's id");
  } else {
    if (calls[1]?.continuesFirst === true)
      findings.push("call 2: continued the first child, but the unit is new");
    if (calls[1]?.hasSessionID === true && calls[1]?.continuesFirst !== true)
      findings.push("call 2: passed a sessionID, but a new unit must not continue a child");
  }

  if (run.childSessions !== expect.childSessions)
    findings.push(`child sessions: expected ${expect.childSessions}, got ${run.childSessions}`);

  for (const call of calls) {
    if (call.status === "error" || call.status === "cancelled")
      findings.push(`call: status ${call.status}, so the scenario did not complete`);
  }

  for (const [file, expected] of Object.entries(expect.files)) {
    const actual = run.files[file];
    if (actual === undefined) findings.push(`${file}: not read`);
    else if (actual !== expected)
      findings.push(`${file}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(short(actual))}`);
  }

  return findings;
};
