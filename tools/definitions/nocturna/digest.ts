import type { Tool } from "@opencode/plugin/effect";
import type { Session } from "@opencode/schema/session";
import type { SessionMessage } from "@opencode/schema/session-message";
import { DateTime } from "effect";

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

const recordToolPart = (
  toolMap: Map<string, MutableToolStat>,
  skills: Set<string>,
  part: SessionMessage.AssistantTool,
): number => {
  const stat = toolMap.get(part.name) ?? { calls: 0, errors: 0 };
  stat.calls += 1;
  if (part.state.status === "error") {
    stat.errors += 1;
    if (stat.sampleError === undefined) {
      stat.sampleError = clipText(`${part.state.error.type}: ${part.state.error.message}`, 160);
    }
  } else if (part.state.status === "completed") {
    if (
      part.name === "skill" &&
      typeof part.state.input === "object" &&
      part.state.input !== null
    ) {
      const skillId = (part.state.input as { id?: unknown }).id;
      if (typeof skillId === "string") skills.add(skillId);
    }
    const metadata = part.state.metadata as { error?: unknown; toolCalls?: unknown } | undefined;
    if (part.name === "execute" && metadata?.error === true) {
      stat.errors += 1;
    }
    recordNestedToolCalls(toolMap, metadata?.toolCalls);
  }
  toolMap.set(part.name, stat);
  return part.name === "subagent" ? 1 : 0;
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
        tally.subagentsSpawned += recordToolPart(tally.toolMap, tally.skills, part);
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
    Math.floor(activeTokens / 50_000)
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

export const digestSession = (
  info: Session.Info,
  messages: ReadonlyArray<SessionMessage.Info>,
): SessionDigest => {
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

  return {
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
    skillsLoaded: [...tally.skills],
    tools,
    anomalyScore: computeAnomalyScore(tally, toolErrors, info),
  };
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
