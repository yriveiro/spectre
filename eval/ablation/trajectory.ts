import type { SessionMessageAssistant, SessionMessageAssistantTool } from "@opencode/client";
import { addUsage, summarizeUsage, type Transcript, type UsageSummary } from "../opencode";
import type { AblationScenario } from "./scenario";
import {
  hasAssertionFailureEvidence,
  hasPassingTestEvidence,
  isSyntaxOrSetupError,
} from "./verify";

export type ShellOutcome =
  | { readonly kind: "passed"; readonly exitCode: 0 }
  | { readonly kind: "failed"; readonly exitCode: number }
  | { readonly kind: "timeout"; readonly exitCode?: number }
  | { readonly kind: "signal"; readonly signal: string }
  | { readonly kind: "killed"; readonly reason?: string }
  | { readonly kind: "backgrounded"; readonly shellID?: string }
  | { readonly kind: "tool-error"; readonly error?: string }
  | { readonly kind: "unknown" };

export interface ExecutedCodeModeCall {
  readonly tool: string;
  readonly status: "running" | "completed" | "error" | "unknown";
  readonly input?: Readonly<Record<string, unknown>>;
  readonly wireFormat: "structured" | "legacy-string";
}

export interface ToolCallEvent {
  readonly id: string;
  readonly sessionKind: "parent" | "child";
  readonly sessionID: string;
  readonly name: string;
  readonly status: SessionMessageAssistantTool["state"]["status"];
  readonly isToolError: boolean;
  readonly createdAt: number;
  readonly ranAt?: number;
  readonly completedAt?: number;
  readonly seq: number;
  readonly input: Readonly<Record<string, unknown>>;
  readonly outputText: string;
  readonly shellOutcome?: ShellOutcome;
  readonly codemodeCalls: ReadonlyArray<ExecutedCodeModeCall>;
}

export interface ActivationMetrics {
  readonly targetSkillLoaded: boolean;
  readonly activatedSkills: ReadonlyArray<string>;
  readonly failedSkillCalls: ReadonlyArray<string>;
}

export interface CausalTrajectoryMetrics {
  readonly causalRedBeforeEdit: boolean;
  readonly testEditedBeforeRedRun: boolean;
  readonly redRunCompletedBeforeProdEdit: boolean;
  readonly greenRunAfterLastProdEdit: boolean;
  readonly redWitnessRejectionReasons: ReadonlyArray<string>;
  readonly toolCalls: number;
  readonly toolErrors: number;
  readonly assistantTurns: number;
  readonly codemodeCalls: ReadonlyArray<ExecutedCodeModeCall>;
  readonly events: ReadonlyArray<ToolCallEvent>;
}

export interface HostCostMetrics {
  readonly usage: UsageSummary;
  readonly hostRecordedUsd: number;
  readonly modelVariant?: string;
}

export interface ExtractedTrajectory {
  readonly activation: ActivationMetrics;
  readonly trajectory: CausalTrajectoryMetrics;
  readonly cost: HostCostMetrics;
}

const readObject = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const readExitInt = (
  output: Record<string, unknown> | undefined,
  metadata: Record<string, unknown> | undefined,
): number | undefined => {
  for (const candidate of [output?.exitCode, metadata?.exit, metadata?.exitCode]) {
    if (typeof candidate === "number" && Number.isInteger(candidate)) return candidate;
  }
  return undefined;
};

const pickText = (
  source: Readonly<Record<string, unknown>> | undefined,
  ...keys: ReadonlyArray<string>
): string | undefined => {
  if (source === undefined) return undefined;
  for (const key of keys) {
    const val = source[key];
    if (typeof val === "string" && val.length > 0) return val;
  }
  return undefined;
};

const collectToolText = (state: SessionMessageAssistantTool["state"]): string => {
  if (state.status !== "completed" && state.status !== "error") return "";
  return (state.content ?? [])
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n");
};

const structuredOutputOf = (
  state: SessionMessageAssistantTool["state"],
): Record<string, unknown> | undefined => {
  if (state.status !== "completed" && state.status !== "error") return undefined;
  return readObject((state as { readonly output?: unknown }).output);
};

export const decodeShellOutcome = (part: SessionMessageAssistantTool): ShellOutcome => {
  const state = part.state;
  if (state.status === "error") {
    const errMsg = pickText(readObject(state.error), "message");
    return { kind: "tool-error", ...(errMsg === undefined ? {} : { error: errMsg }) };
  }
  if (state.status === "streaming" || state.status === "running") {
    const shellID =
      state.status === "running" ? pickText(readObject(state.metadata), "shellID") : undefined;
    return { kind: "backgrounded", ...(shellID === undefined ? {} : { shellID }) };
  }

  const metadata = readObject(state.metadata);
  const output = structuredOutputOf(state);

  const shellID = pickText(output, "shellID") ?? pickText(metadata, "shellID");
  if (metadata?.status === "running" || shellID !== undefined) {
    return { kind: "backgrounded", ...(shellID === undefined ? {} : { shellID }) };
  }

  if (metadata?.timeout === true || output?.timeout === true) {
    const code = readExitInt(output, metadata);
    return { kind: "timeout", ...(code === undefined ? {} : { exitCode: code }) };
  }

  if (metadata?.killed === true || typeof output?.killed === "string") {
    const reason = pickText(output, "killed");
    return { kind: "killed", ...(reason === undefined ? {} : { reason }) };
  }

  const signal = pickText(output, "signal") ?? pickText(metadata, "signal");
  if (signal !== undefined) {
    return { kind: "signal", signal };
  }

  const exitCode = readExitInt(output, metadata);
  if (exitCode === 0) return { kind: "passed", exitCode: 0 };
  if (exitCode !== undefined) return { kind: "failed", exitCode };

  return { kind: "unknown" };
};

export const decodeCodeModeCalls = (
  part: SessionMessageAssistantTool,
): ReadonlyArray<ExecutedCodeModeCall> => {
  if (part.name !== "execute" || part.state.status === "streaming") return [];
  const metadata = readObject(part.state.metadata);
  const output = structuredOutputOf(part.state);
  const rawCalls = Array.isArray(output?.toolCalls)
    ? output.toolCalls
    : Array.isArray(metadata?.toolCalls)
      ? metadata.toolCalls
      : [];

  const decoded: Array<ExecutedCodeModeCall> = [];
  for (const entry of rawCalls) {
    const rec = readObject(entry);
    if (rec !== undefined && typeof rec.tool === "string" && rec.tool.length > 0) {
      const status =
        rec.status === "running" || rec.status === "completed" || rec.status === "error"
          ? rec.status
          : "unknown";
      const nestedInput = readObject(rec.input);
      decoded.push({
        tool: rec.tool,
        status,
        ...(nestedInput === undefined ? {} : { input: nestedInput }),
        wireFormat: "structured",
      });
    } else if (typeof entry === "string" && entry.length > 0) {
      decoded.push({
        tool: entry,
        status: "unknown",
        wireFormat: "legacy-string",
      });
    }
  }
  return decoded;
};

const normalizePath = (rawPath: string, workspaceDir?: string): string => {
  let cleaned = rawPath.replaceAll("\\", "/");
  if (workspaceDir !== undefined) {
    const prefix = workspaceDir.replaceAll("\\", "/").replace(/\/+$/, "");
    if (cleaned.startsWith(`${prefix}/`)) {
      cleaned = cleaned.slice(prefix.length + 1);
    }
  }
  return cleaned.replace(/^\.\//, "");
};

const matchesTargetFiles = (
  rawPath: string | undefined,
  targets: ReadonlyArray<string>,
  workspaceDir?: string,
): boolean => {
  if (rawPath === undefined || rawPath === "") return false;
  const normalized = normalizePath(rawPath, workspaceDir);
  return targets.some((target) => normalized === target || normalized.endsWith(`/${target}`));
};

const fileArgOf = (event: ToolCallEvent): string | undefined =>
  pickText(event.input, "path", "filePath");

const startTimeOf = (event: ToolCallEvent): number => event.ranAt ?? event.createdAt;

const isCompletedWitness = (event: ToolCallEvent): boolean =>
  event.status === "completed" && event.completedAt !== undefined;

const startedEarlier = (left: ToolCallEvent, right: ToolCallEvent): boolean => {
  const leftStart = startTimeOf(left);
  const rightStart = startTimeOf(right);
  if (leftStart !== rightStart) return leftStart < rightStart;
  return left.sessionID === right.sessionID && left.seq < right.seq;
};

const completedBeforeStart = (earlier: ToolCallEvent, later: ToolCallEvent): boolean => {
  if (!isCompletedWitness(earlier)) return false;
  const earlierEnd = earlier.completedAt!;
  const laterStart = startTimeOf(later);
  if (earlierEnd < laterStart) return true;
  if (earlierEnd > laterStart) return false;
  return earlier.sessionID === later.sessionID && earlier.seq < later.seq;
};

const collectEvents = (
  messages: ReadonlyArray<SessionMessageAssistant>,
  sessionKind: "parent" | "child",
  sessionID: string,
  seqStart: number,
  out: Array<ToolCallEvent>,
): number => {
  let seq = seqStart;
  for (const message of messages) {
    for (const part of message.content) {
      if (part.type !== "tool" || part.state.status === "streaming") continue;
      const input = readObject(part.state.input) ?? {};
      const shellOutcome =
        part.name === "shell" || part.name === "bash" ? decodeShellOutcome(part) : undefined;
      const codemodeCalls = decodeCodeModeCalls(part);
      out.push({
        id: part.id,
        sessionKind,
        sessionID,
        name: part.name,
        status: part.state.status,
        isToolError: part.state.status === "error",
        createdAt: part.time.created,
        ...(part.time.ran === undefined ? {} : { ranAt: part.time.ran }),
        ...(part.time.completed === undefined ? {} : { completedAt: part.time.completed }),
        seq: seq++,
        input,
        outputText: collectToolText(part.state),
        ...(shellOutcome === undefined ? {} : { shellOutcome }),
        codemodeCalls,
      });
    }
  }
  return seq;
};

const classifyRedWitness = (
  run: ToolCallEvent,
  earliestProdEdit: ToolCallEvent,
): "valid" | "ignore" | string => {
  if (!startedEarlier(run, earliestProdEdit)) return "ignore";
  if (!completedBeforeStart(run, earliestProdEdit)) {
    return run.shellOutcome?.kind === "failed"
      ? "red_test_not_completed_before_prod_edit"
      : "red_test_incomplete_or_non_exit";
  }
  const outcome = run.shellOutcome;
  if (outcome === undefined || outcome.kind === "passed") return "ignore";
  if (outcome.kind !== "failed") return "red_test_incomplete_or_non_exit";
  if (isSyntaxOrSetupError(run.outputText)) return "red_test_was_syntax_or_setup_error";
  if (!hasAssertionFailureEvidence(run.outputText)) return "red_test_missing_assertion_evidence";
  return "valid";
};

const collectValidRedWitnesses = (
  testRuns: ReadonlyArray<ToolCallEvent>,
  earliestProdEdit: ToolCallEvent,
  reasons: Set<string>,
): ReadonlyArray<ToolCallEvent> => {
  const valid: Array<ToolCallEvent> = [];
  for (const run of testRuns) {
    const verdict = classifyRedWitness(run, earliestProdEdit);
    if (verdict === "valid") valid.push(run);
    else if (verdict !== "ignore") reasons.add(verdict);
  }
  return valid;
};

const hasGreenRunAfterProdEdits = (
  testRuns: ReadonlyArray<ToolCallEvent>,
  prodEdits: ReadonlyArray<ToolCallEvent>,
  reasons: Set<string>,
): boolean => {
  if (prodEdits.some((edit) => !isCompletedWitness(edit))) {
    reasons.add("unsettled_or_errored_prod_edit");
    return false;
  }
  const latestProdEditCompletedAt = prodEdits.reduce(
    (max, edit) => Math.max(max, edit.completedAt!),
    -Infinity,
  );
  return testRuns.some(
    (run) =>
      isCompletedWitness(run) &&
      run.shellOutcome?.kind === "passed" &&
      hasPassingTestEvidence(run.outputText) &&
      startTimeOf(run) >= latestProdEditCompletedAt &&
      prodEdits.every((edit) => completedBeforeStart(edit, run)),
  );
};

const gradeCausalRedBeforeEdit = (input: {
  readonly scenario: AblationScenario;
  readonly events: ReadonlyArray<ToolCallEvent>;
  readonly workspaceDir?: string;
}): {
  readonly causalRedBeforeEdit: boolean;
  readonly testEditedBeforeRedRun: boolean;
  readonly redRunCompletedBeforeProdEdit: boolean;
  readonly greenRunAfterLastProdEdit: boolean;
  readonly redWitnessRejectionReasons: ReadonlyArray<string>;
} => {
  const testCmd = new RegExp(input.scenario.testCommandRegex);
  const editEvents = input.events.filter(
    (event) => event.name === "edit" || event.name === "write",
  );
  const prodEdits = editEvents.filter((event) =>
    matchesTargetFiles(fileArgOf(event), input.scenario.productionFiles, input.workspaceDir),
  );
  const testEdits = editEvents.filter(
    (event) =>
      isCompletedWitness(event) &&
      matchesTargetFiles(fileArgOf(event), input.scenario.testFiles, input.workspaceDir),
  );
  const testRuns = input.events.filter(
    (event) =>
      (event.name === "shell" || event.name === "bash") &&
      testCmd.test(pickText(event.input, "command") ?? ""),
  );

  const reasons = new Set<string>();
  const firstProdEdit = prodEdits[0];
  if (firstProdEdit === undefined) {
    reasons.add("no_production_edit");
    return {
      causalRedBeforeEdit: false,
      testEditedBeforeRedRun: false,
      redRunCompletedBeforeProdEdit: false,
      greenRunAfterLastProdEdit: false,
      redWitnessRejectionReasons: [...reasons],
    };
  }

  let earliestProdEdit = firstProdEdit;
  for (const edit of prodEdits.slice(1)) {
    if (startedEarlier(edit, earliestProdEdit)) earliestProdEdit = edit;
  }

  const validRedWitnesses = collectValidRedWitnesses(testRuns, earliestProdEdit, reasons);
  const redRunCompletedBeforeProdEdit = validRedWitnesses.length > 0;
  if (!redRunCompletedBeforeProdEdit && reasons.size === 0) {
    reasons.add("prod_edit_before_red_test");
  }

  const testEditedBeforeRedRun = validRedWitnesses.some((redRun) =>
    testEdits.some((testEdit) => completedBeforeStart(testEdit, redRun)),
  );
  if (redRunCompletedBeforeProdEdit && !testEditedBeforeRedRun) {
    reasons.add("no_test_edit_before_red_run");
  }

  const greenRunAfterLastProdEdit = hasGreenRunAfterProdEdits(testRuns, prodEdits, reasons);
  if (!greenRunAfterLastProdEdit) {
    reasons.add("no_green_test_after_last_prod_edit");
  }

  const causalRedBeforeEdit =
    testEditedBeforeRedRun && redRunCompletedBeforeProdEdit && greenRunAfterLastProdEdit;

  return {
    causalRedBeforeEdit,
    testEditedBeforeRedRun,
    redRunCompletedBeforeProdEdit,
    greenRunAfterLastProdEdit,
    redWitnessRejectionReasons: causalRedBeforeEdit ? [] : [...reasons],
  };
};

export const extractTrajectory = (input: {
  readonly scenario: AblationScenario;
  readonly parent: Transcript;
  readonly children: ReadonlyMap<string, Transcript>;
  readonly workspaceDir?: string;
}): ExtractedTrajectory => {
  const rawEvents: Array<ToolCallEvent> = [];
  let seq = collectEvents(input.parent.messages, "parent", "parent", 0, rawEvents);
  for (const [childId, childTranscript] of input.children.entries()) {
    seq = collectEvents(childTranscript.messages, "child", childId, seq, rawEvents);
  }

  const events = rawEvents.toSorted(
    (left, right) =>
      startTimeOf(left) - startTimeOf(right) ||
      left.createdAt - right.createdAt ||
      left.seq - right.seq,
  );

  const activatedSet = new Set<string>(input.parent.activated);
  for (const child of input.children.values()) {
    for (const id of child.activated) activatedSet.add(id);
  }
  const failedSkillSet = new Set<string>();
  for (const event of events) {
    if (event.name !== "skill") continue;
    const id = pickText(event.input, "id");
    if (id === undefined) continue;
    if (event.status === "completed") activatedSet.add(id);
    else if (event.status === "error") failedSkillSet.add(id);
  }

  const activatedSkills = [...activatedSet];
  const failedSkillCalls = [...failedSkillSet];

  const causal = gradeCausalRedBeforeEdit({
    scenario: input.scenario,
    events,
    workspaceDir: input.workspaceDir,
  });

  const usageSummaries: Array<UsageSummary> = [
    input.parent.usage ?? summarizeUsage(input.parent.messages),
    ...[...input.children.values()].map(
      (child) => child.usage ?? summarizeUsage(child.messages),
    ),
  ];
  const usage = addUsage(usageSummaries);
  const assistantTurns =
    input.parent.messages.length +
    [...input.children.values()].reduce((sum, child) => sum + child.messages.length, 0);

  const modelVariant = input.parent.messages
    .map((message) => pickText(readObject(message.model), "variant"))
    .find((variant) => variant !== undefined);

  return {
    activation: {
      targetSkillLoaded: activatedSet.has(input.scenario.targetSkill),
      activatedSkills,
      failedSkillCalls,
    },
    trajectory: {
      ...causal,
      toolCalls: events.length,
      toolErrors: events.filter((event) => event.isToolError).length,
      assistantTurns,
      codemodeCalls: events.flatMap((event) => event.codemodeCalls),
      events,
    },
    cost: {
      usage,
      hostRecordedUsd: usage.cost,
      ...(modelVariant === undefined ? {} : { modelVariant }),
    },
  };
};
