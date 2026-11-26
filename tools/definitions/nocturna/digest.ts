import type { Tool } from "@opencode/plugin/effect";
import type { Session } from "@opencode/schema/session";
import type { SessionMessage } from "@opencode/schema/session-message";
import { DateTime, Predicate } from "effect";
import {
  canonicalizeFailedSkillID,
  countNestedToolErrors,
  hasShellFailureOutput,
  KNOWN_SPECTRE_SKILL_IDS,
  sanitizeCompletedSkillID,
} from "./telemetry";
import {
  mergeAttributedStep,
  type SessionTelemetryRecord,
  type StoredAttributedStep,
  type StoredSkillLoad,
} from "./telemetry-store";

export const toMillis = (value: DateTime.DateTime | number): number =>
  typeof value === "number" ? value : DateTime.toEpochMillis(value);

export const clipText = (text: string, maxChars: number): string => {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxChars) return collapsed;
  return `${collapsed.slice(0, Math.max(1, maxChars - 1))}…`;
};

export interface ToolStat {
  readonly name: string;
  readonly calls: number;
  readonly errors: number;
  readonly sampleError?: string;
}

export type TelemetryCoverage = "live" | "transcript" | "hybrid" | "none";

export interface ReconciledSessionTelemetry {
  readonly coverage: TelemetryCoverage;
  readonly partial: boolean;
  readonly loads: ReadonlyArray<StoredSkillLoad>;
  readonly steps: ReadonlyArray<StoredAttributedStep>;
}

export interface SessionDigest {
  readonly id: string;
  readonly parentID?: string;
  readonly agent?: string;
  readonly model?: string;
  readonly title?: string;
  readonly outcome?: "succeeded" | "failed" | "interrupted";
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly cost: number;
  readonly tokens: {
    readonly input: number;
    readonly output: number;
    readonly reasoning: number;
    readonly cacheRead: number;
    readonly cacheWrite: number;
  };
  readonly compacted: boolean;
  readonly userTurns: number;
  readonly assistantSteps: number;
  readonly compactions: number;
  readonly retries: number;
  readonly subagentsSpawned: number;
  readonly shellFailed: number;
  readonly skillsLoaded: Array<string>;
  readonly tools: Array<ToolStat>;
  readonly anomalyScore: number;
  readonly telemetryCoverage: TelemetryCoverage;
  readonly telemetryPartial?: boolean;
}

export interface SessionDigestResult {
  readonly digest: SessionDigest;
  readonly telemetry: ReconciledSessionTelemetry;
}

interface MutableToolStat {
  calls: number;
  errors: number;
  sampleError?: string;
}

interface MessageTally {
  userTurns: number;
  assistantSteps: number;
  compactions: number;
  retries: number;
  subagentsSpawned: number;
  shellFailed: number;
  readonly skills: Set<string>;
  readonly toolMap: Map<string, MutableToolStat>;
}

const recordNestedToolCalls = (toolMap: Map<string, MutableToolStat>, toolCalls: unknown): void => {
  if (!Array.isArray(toolCalls)) return;
  for (const item of toolCalls) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as { tool?: unknown; status?: unknown };
    if (typeof record.tool !== "string") continue;
    const stat = toolMap.get(record.tool) ?? { calls: 0, errors: 0 };
    stat.calls += 1;
    if (record.status === "error") stat.errors += 1;
    toolMap.set(record.tool, stat);
  }
};

const isSubagentResume = (part: SessionMessage.AssistantTool): boolean => {
  if (part.state.status === "streaming") return false;
  if (typeof part.state.input !== "object" || part.state.input === null) return false;
  const sessionID = (part.state.input as { sessionID?: unknown }).sessionID;
  return typeof sessionID === "string" && sessionID.trim().length > 0;
};

const recordCompletedToolPart = (
  tally: MessageTally,
  stat: MutableToolStat,
  name: string,
  state: Extract<SessionMessage.AssistantTool["state"], { readonly status: "completed" }>,
): void => {
  if (name === "skill" && typeof state.input === "object" && state.input !== null) {
    const skillId = (state.input as { id?: unknown }).id;
    if (typeof skillId === "string") tally.skills.add(skillId);
  }
  if (name === "shell" && hasShellFailureOutput(state.content)) {
    tally.shellFailed += 1;
  }
  const metadata = state.metadata as { error?: unknown; toolCalls?: unknown } | undefined;
  if (name === "execute" && metadata?.error === true) {
    stat.errors += 1;
  }
  recordNestedToolCalls(tally.toolMap, metadata?.toolCalls);
};

const recordToolPart = (tally: MessageTally, part: SessionMessage.AssistantTool): void => {
  const stat = tally.toolMap.get(part.name) ?? { calls: 0, errors: 0 };
  stat.calls += 1;
  if (part.state.status === "error") {
    stat.errors += 1;
    if (stat.sampleError === undefined) {
      stat.sampleError = clipText(`${part.state.error.type}: ${part.state.error.message}`, 160);
    }
    if (part.name === "shell") tally.shellFailed += 1;
  } else if (part.state.status === "completed") {
    recordCompletedToolPart(tally, stat, part.name, part.state);
  }
  tally.toolMap.set(part.name, stat);
  if (part.name === "subagent" && !isSubagentResume(part)) {
    tally.subagentsSpawned += 1;
  }
};

const accumulateMessage = (tally: MessageTally, message: SessionMessage.Info): void => {
  if (message.type === "user") {
    tally.userTurns += 1;
    return;
  }
  if (message.type === "skill") {
    tally.skills.add(message.skill);
    return;
  }
  if (message.type === "compaction") {
    tally.compactions += 1;
    return;
  }
  if (message.type === "shell") {
    if (message.exit !== undefined && message.exit !== 0) tally.shellFailed += 1;
    return;
  }
  if (message.type === "assistant") {
    tally.assistantSteps += 1;
    if (message.retry !== undefined) tally.retries += 1;
    for (const part of message.content) {
      if (part.type === "tool") {
        recordToolPart(tally, part);
      }
    }
  }
};

const sortedToolStats = (toolMap: ReadonlyMap<string, MutableToolStat>): Array<ToolStat> =>
  [...toolMap.entries()]
    .map(([name, stat]) => ({
      name,
      calls: stat.calls,
      errors: stat.errors,
      ...(stat.sampleError === undefined ? {} : { sampleError: stat.sampleError }),
    }))
    .toSorted(
      (left, right) =>
        right.errors - left.errors ||
        right.calls - left.calls ||
        left.name.localeCompare(right.name),
    );

const computeAnomalyScore = (
  tally: MessageTally,
  toolErrors: number,
  info: Session.Info,
): number => {
  const activeTokens = info.tokens.input + info.tokens.output + info.tokens.reasoning;
  const outcomePenalty = info.outcome === "failed" ? 30 : 0;
  return (
    toolErrors * 25 +
    tally.retries * 20 +
    tally.compactions * 15 +
    tally.shellFailed * 10 +
    outcomePenalty +
    Math.floor(activeTokens / 50_000) +
    Math.floor(info.cost * 2) +
    Math.floor(tally.assistantSteps / 10) +
    Math.floor(info.tokens.cache.read / 1_000_000)
  );
};

const optionalMetadata = (info: Session.Info) => {
  const model =
    info.model === undefined
      ? undefined
      : `${info.model.providerID}/${info.model.id}${info.model.variant === undefined ? "" : `#${info.model.variant}`}`;
  return {
    ...(info.parentID === undefined ? {} : { parentID: info.parentID }),
    ...(info.agent === undefined ? {} : { agent: info.agent }),
    ...(model === undefined ? {} : { model }),
    ...(info.title === undefined ? {} : { title: info.title }),
    ...(info.outcome === undefined ? {} : { outcome: info.outcome }),
  };
};

const messageCreatedTime = (message: SessionMessage.Info): number | undefined => {
  const created = (message as { readonly time?: { readonly created?: DateTime.DateTime | number } })
    .time?.created;
  return created === undefined ? undefined : toMillis(created);
};

const countToolPartPostLoadErrors = (part: SessionMessage.AssistantTool): number => {
  if (part.name === "skill") return 0;
  if (part.state.status === "error") return 1;
  if (part.state.status !== "completed") return 0;
  if (part.name === "execute") {
    const metadata = part.state.metadata as
      | { readonly error?: unknown; readonly toolCalls?: unknown }
      | undefined;
    const nested = countNestedToolErrors(metadata?.toolCalls);
    return metadata?.error === true && nested === 0 ? 1 : nested;
  }
  return part.name === "shell" && hasShellFailureOutput(part.state.content) ? 1 : 0;
};

const countAssistantPostLoadErrors = (
  content: ReadonlyArray<SessionMessage.AssistantContent>,
): number => {
  let errors = 0;
  for (const part of content) {
    if (part.type === "tool") errors += countToolPartPostLoadErrors(part);
  }
  return errors;
};

interface TranscriptSkillExtract {
  readonly loads: Array<StoredSkillLoad>;
  readonly steps: Array<StoredAttributedStep>;
  readonly hasCompletedCompaction: boolean;
}

interface ReplayState {
  turnSeq: number;
  currentTurnID: string;
  hasCompletedCompaction: boolean;
  readonly activeSkills: Set<string>;
  readonly pendingToolSkills: Set<string>;
  readonly loads: Array<StoredSkillLoad>;
  readonly steps: Array<StoredAttributedStep>;
  readonly knownSkillIDs: Set<string>;
}

const replaySkillToolPart = (
  state: ReplayState,
  part: SessionMessage.AssistantTool,
  at: number,
): void => {
  const rawId =
    part.state.status === "streaming" || !Predicate.isObject(part.state.input)
      ? undefined
      : (part.state.input as { id?: unknown }).id;
  if (part.state.status === "completed") {
    const skill = sanitizeCompletedSkillID(rawId);
    if (skill === undefined) return;
    state.knownSkillIDs.add(skill);
    state.loads.push({
      id: `tool:${part.id}`,
      turnID: state.currentTurnID,
      skill,
      trigger: "agent-tool",
      status: "completed",
      at,
    });
    state.pendingToolSkills.add(skill);
    return;
  }
  if (part.state.status === "error") {
    state.loads.push({
      id: `tool:${part.id}`,
      turnID: state.currentTurnID,
      skill: canonicalizeFailedSkillID(rawId, state.knownSkillIDs),
      trigger: "agent-tool",
      status: "error",
      at,
    });
  }
};

const replayAssistantMessage = (
  state: ReplayState,
  message: SessionMessage.Assistant,
  at: number,
): void => {
  for (const skill of state.pendingToolSkills) state.activeSkills.add(skill);
  state.pendingToolSkills.clear();

  if (state.activeSkills.size > 0) {
    const hasUsage = message.cost !== undefined && message.tokens !== undefined;
    state.steps.push({
      assistantMessageID: message.id,
      turnID: state.currentTurnID,
      skills: [...state.activeSkills].toSorted(),
      ...(hasUsage
        ? {
            cost: message.cost,
            tokens: {
              input: message.tokens.input,
              output: message.tokens.output,
              reasoning: message.tokens.reasoning,
              cacheRead: message.tokens.cache.read,
              cacheWrite: message.tokens.cache.write,
            },
          }
        : {}),
      postLoadErrors: countAssistantPostLoadErrors(message.content),
    });
  }

  for (const part of message.content) {
    if (part.type === "tool" && part.name === "skill") {
      replaySkillToolPart(state, part, at);
    }
  }
};

const replayUserMessage = (
  state: ReplayState,
  message: SessionMessage.User,
  at: number,
): void => {
  const seen = new Set<string>();
  for (const attached of message.skills ?? []) {
    const skill = sanitizeCompletedSkillID(attached.id);
    if (skill === undefined || seen.has(skill)) continue;
    seen.add(skill);
    state.knownSkillIDs.add(skill);
    state.loads.push({
      id: `prompt:${message.id}:${skill}`,
      turnID: state.currentTurnID,
      skill,
      trigger: "prompt-attachment",
      status: "completed",
      at,
    });
    state.activeSkills.add(skill);
  }
};

const closeReplayTurn = (state: ReplayState): void => {
  state.activeSkills.clear();
  state.pendingToolSkills.clear();
  state.turnSeq += 1;
  state.currentTurnID = `tx:${state.turnSeq}`;
};

const replayOneMessage = (
  state: ReplayState,
  message: SessionMessage.Info,
  at: number,
): void => {
  if (message.type === "compaction") {
    if (message.status === "completed") {
      state.hasCompletedCompaction = true;
      closeReplayTurn(state);
    }
    return;
  }
  if (message.type === "idle") {
    closeReplayTurn(state);
    return;
  }
  if (message.type === "user") {
    replayUserMessage(state, message, at);
    return;
  }
  if (message.type === "skill") {
    const skill = sanitizeCompletedSkillID(message.skill);
    if (skill === undefined) return;
    state.knownSkillIDs.add(skill);
    state.loads.push({
      id: `act:${message.id}`,
      turnID: state.currentTurnID,
      skill,
      trigger: "api-activation",
      status: "completed",
      at,
    });
    state.activeSkills.add(skill);
    return;
  }
  if (message.type === "assistant") {
    replayAssistantMessage(state, message, at);
  }
};

export const extractTranscriptSkillTelemetry = (
  info: Session.Info,
  messages: ReadonlyArray<SessionMessage.Info>,
  knownSkillIDs: ReadonlySet<string> = KNOWN_SPECTRE_SKILL_IDS,
): TranscriptSkillExtract => {
  const forkCutoff = info.fork === undefined ? undefined : toMillis(info.time.created);
  const fallbackAt = toMillis(info.time.updated);
  const state: ReplayState = {
    turnSeq: 0,
    currentTurnID: "tx:0",
    hasCompletedCompaction: false,
    activeSkills: new Set(),
    pendingToolSkills: new Set(),
    loads: [],
    steps: [],
    knownSkillIDs: new Set(knownSkillIDs),
  };

  for (const message of messages) {
    const created = messageCreatedTime(message);
    if (forkCutoff !== undefined && created !== undefined && created < forkCutoff) continue;
    replayOneMessage(state, message, created ?? fallbackAt);
  }

  return {
    loads: state.loads,
    steps: state.steps,
    hasCompletedCompaction: state.hasCompletedCompaction,
  };
};

const reconcileLoads = (
  liveLoads: ReadonlyArray<StoredSkillLoad>,
  txLoads: ReadonlyArray<StoredSkillLoad>,
): { readonly loads: Array<StoredSkillLoad>; readonly added: boolean } => {
  const byId = new Map<string, StoredSkillLoad>();
  for (const load of liveLoads) byId.set(load.id, load);
  let added = false;
  for (const txLoad of txLoads) {
    if (!byId.has(txLoad.id)) {
      byId.set(txLoad.id, txLoad);
      added = true;
    }
  }
  return { loads: [...byId.values()], added };
};

const reconcileSteps = (
  liveSteps: ReadonlyArray<StoredAttributedStep>,
  txSteps: ReadonlyArray<StoredAttributedStep>,
): { readonly steps: Array<StoredAttributedStep>; readonly added: boolean } => {
  const byId = new Map<string, StoredAttributedStep>();
  for (const step of liveSteps) byId.set(step.assistantMessageID, step);
  let added = false;
  for (const txStep of txSteps) {
    const existing = byId.get(txStep.assistantMessageID);
    if (existing === undefined) {
      byId.set(txStep.assistantMessageID, txStep);
      added = true;
      continue;
    }
    const merged = mergeAttributedStep(
      { ...txStep, assistantMessageID: existing.assistantMessageID, turnID: existing.turnID },
      existing,
    );
    if (
      merged.skills.length > existing.skills.length ||
      (existing.cost === undefined && merged.cost !== undefined)
    ) {
      added = true;
    }
    byId.set(txStep.assistantMessageID, merged);
  }
  return { steps: [...byId.values()], added };
};

export const reconcileSessionTelemetry = (
  live: SessionTelemetryRecord | undefined,
  transcript: TranscriptSkillExtract,
): ReconciledSessionTelemetry => {
  if (live === undefined) {
    const hasActivity = transcript.loads.length > 0 || transcript.steps.length > 0;
    return {
      coverage: hasActivity ? "transcript" : "none",
      partial: transcript.hasCompletedCompaction,
      loads: transcript.loads,
      steps: transcript.steps,
    };
  }

  const loads = reconcileLoads(live.loads, transcript.loads);
  const steps = reconcileSteps(live.steps, transcript.steps);
  const addedFromTranscript = loads.added || steps.added;
  return {
    coverage: addedFromTranscript ? "hybrid" : "live",
    partial:
      live.partial ||
      live.truncated ||
      (addedFromTranscript && transcript.hasCompletedCompaction),
    loads: loads.loads,
    steps: steps.steps,
  };
};

const completedSkillIDs = (loads: ReadonlyArray<StoredSkillLoad>): Array<string> => {
  const seen = new Set<string>();
  const out: Array<string> = [];
  for (const load of loads) {
    if (load.status !== "completed" || seen.has(load.skill)) continue;
    seen.add(load.skill);
    out.push(load.skill);
  }
  return out;
};

export const digestSession = (
  info: Session.Info,
  messages: ReadonlyArray<SessionMessage.Info>,
  live?: SessionTelemetryRecord,
): SessionDigestResult => {
  const tally: MessageTally = {
    userTurns: 0,
    assistantSteps: 0,
    compactions: 0,
    retries: 0,
    subagentsSpawned: 0,
    shellFailed: 0,
    skills: new Set<string>(),
    toolMap: new Map<string, MutableToolStat>(),
  };

  for (const message of messages) accumulateMessage(tally, message);

  const tools = sortedToolStats(tally.toolMap);
  const toolErrors = tools.reduce((sum, item) => sum + item.errors, 0);
  const transcript = extractTranscriptSkillTelemetry(info, messages);
  const telemetry = reconcileSessionTelemetry(live, transcript);

  const digest: SessionDigest = {
    id: info.id,
    ...optionalMetadata(info),
    createdAt: toMillis(info.time.created),
    updatedAt: toMillis(info.time.updated),
    cost: info.cost,
    tokens: {
      input: info.tokens.input,
      output: info.tokens.output,
      reasoning: info.tokens.reasoning,
      cacheRead: info.tokens.cache.read,
      cacheWrite: info.tokens.cache.write,
    },
    compacted: tally.compactions > 0,
    userTurns: tally.userTurns,
    assistantSteps: tally.assistantSteps,
    compactions: tally.compactions,
    retries: tally.retries,
    subagentsSpawned: tally.subagentsSpawned,
    shellFailed: tally.shellFailed,
    skillsLoaded: completedSkillIDs(telemetry.loads),
    tools,
    anomalyScore: computeAnomalyScore(tally, toolErrors, info),
    telemetryCoverage: telemetry.coverage,
    ...(telemetry.partial ? { telemetryPartial: true } : {}),
  };

  return { digest, telemetry };
};

export interface InspectedCall {
  readonly id: string;
  readonly name: string;
  readonly status: "streaming" | "running" | "completed" | "error";
  readonly inputPreview: string;
  readonly outputPreview?: string;
  readonly error?: string;
}

export interface InspectedEvent {
  readonly messageID: string;
  readonly kind: "user" | "skill" | "shell" | "assistant" | "compaction" | "idle";
  readonly summary: string;
  readonly calls?: Array<InspectedCall>;
}

const previewContent = (
  content: ReadonlyArray<Tool.Content>,
  maxChars: number,
): string | undefined => {
  const texts = content.flatMap((item) =>
    item.type === "text" ? [item.text] : [`[file:${item.mime}]`],
  );
  if (texts.length === 0) return undefined;
  return clipText(texts.join(" "), maxChars);
};

const inspectToolCall = (part: SessionMessage.AssistantTool, maxChars: number): InspectedCall => {
  const rawInput =
    part.state.status === "streaming" ? part.state.input : JSON.stringify(part.state.input);
  const inputPreview = clipText(rawInput, maxChars);

  if (part.state.status === "error") {
    return {
      id: part.id,
      name: part.name,
      status: "error",
      inputPreview,
      error: clipText(`${part.state.error.type}: ${part.state.error.message}`, maxChars),
    };
  }

  if (part.state.status === "completed") {
    const outputPreview = previewContent(part.state.content, maxChars);
    return {
      id: part.id,
      name: part.name,
      status: "completed",
      inputPreview,
      ...(outputPreview === undefined ? {} : { outputPreview }),
    };
  }

  return {
    id: part.id,
    name: part.name,
    status: part.state.status,
    inputPreview,
  };
};

const inspectAssistantMessage = (
  message: SessionMessage.Assistant,
  maxChars: number,
): InspectedEvent => {
  const texts = message.content.flatMap((part) => (part.type === "text" ? [part.text] : []));
  const calls = message.content.flatMap((part) =>
    part.type === "tool" ? [inspectToolCall(part, maxChars)] : [],
  );
  const retryTag =
    message.retry === undefined
      ? ""
      : ` [retry #${message.retry.attempt}: ${clipText(message.retry.error.message, 80)}]`;
  const errorTag =
    message.error === undefined ? "" : ` [error: ${clipText(message.error.message, 80)}]`;
  const baseText =
    texts.length > 0 ? clipText(texts.join(" "), maxChars) : `${calls.length} tool call(s)`;

  return {
    messageID: message.id,
    kind: "assistant",
    summary: `${baseText}${retryTag}${errorTag}`,
    ...(calls.length === 0 ? {} : { calls }),
  };
};

const inspectCompaction = (
  message: SessionMessage.Compaction,
  maxChars: number,
): InspectedEvent => {
  const detail =
    message.status === "failed"
      ? clipText(message.error.message, maxChars)
      : clipText(message.summary, maxChars);
  return {
    messageID: message.id,
    kind: "compaction",
    summary:
      detail.length > 0
        ? `${message.status} (${message.reason}): ${detail}`
        : `${message.status} (${message.reason})`,
  };
};

const inspectOneMessage = (
  message: SessionMessage.Info,
  maxChars: number,
): InspectedEvent | undefined => {
  if (message.type === "user") {
    return { messageID: message.id, kind: "user", summary: clipText(message.text, maxChars) };
  }
  if (message.type === "skill") {
    return { messageID: message.id, kind: "skill", summary: `loaded skill ${message.skill}` };
  }
  if (message.type === "shell") {
    return {
      messageID: message.id,
      kind: "shell",
      summary: `exit=${message.exit ?? "n/a"} cmd=${clipText(message.command, maxChars)}`,
    };
  }
  if (message.type === "compaction") return inspectCompaction(message, maxChars);
  if (message.type === "idle") {
    const summary =
      message.error === undefined
        ? message.outcome
        : `${message.outcome}: ${clipText(message.error.message, maxChars)}`;
    return { messageID: message.id, kind: "idle", summary };
  }
  if (message.type === "assistant") return inspectAssistantMessage(message, maxChars);
  return undefined;
};

export const inspectMessages = (
  messages: ReadonlyArray<SessionMessage.Info>,
  maxChars: number,
): Array<InspectedEvent> =>
  messages.flatMap((message) => {
    const event = inspectOneMessage(message, maxChars);
    return event === undefined ? [] : [event];
  });
