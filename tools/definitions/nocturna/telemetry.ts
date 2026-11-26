import type { Plugin, Tool } from "@opencode/plugin/effect";
import { Session } from "@opencode/schema/session";
import {
  Cause,
  Effect,
  Fiber,
  Option,
  Predicate,
  Queue,
  Result,
  Schema,
  type Scope,
  Stream,
} from "effect";
import { definitions } from "../../../skills/definitions";
import {
  deleteSessionTelemetry,
  logTelemetryError,
  MAX_LOADS_PER_SESSION,
  MAX_STEPS_PER_SESSION,
  type SessionTelemetryRecord,
  type SkillTrigger,
  type StoredAttributedStep,
  type StoredSkillLoad,
  type StoredTokens,
  UNKNOWN_SKILL_ID,
  writeSessionTelemetry,
} from "./telemetry-store";

const MAX_TRACKED_SESSIONS = 256;
const MAX_BOUNDED_ENTRIES = 64;
const QUEUE_CAPACITY = 1_024;
const MAX_SKILL_ID_LENGTH = 128;

export const SHELL_EXIT_FAILURE = /\bExit code:\s*[1-9]\d*\b/i;

export const KNOWN_SPECTRE_SKILL_IDS: ReadonlySet<string> = new Set(
  definitions.map((definition) => definition.id as string),
);

export const hasShellFailureOutput = (content: ReadonlyArray<Tool.Content>): boolean => {
  for (const item of content) {
    if (item.type === "text" && SHELL_EXIT_FAILURE.test(item.text)) return true;
  }
  return false;
};

export const countNestedToolErrors = (toolCalls: unknown): number => {
  if (!Array.isArray(toolCalls)) return 0;
  let errors = 0;
  for (const item of toolCalls) {
    if (!Predicate.isObject(item)) continue;
    if ((item as { status?: unknown }).status === "error") errors += 1;
  }
  return errors;
};

const isSafeSkillID = (value: string): boolean => {
  if (value.length === 0 || value.length > MAX_SKILL_ID_LENGTH) return false;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
};

export const sanitizeCompletedSkillID = (raw: unknown): string | undefined => {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return isSafeSkillID(trimmed) ? trimmed : undefined;
};

export const canonicalizeFailedSkillID = (
  raw: unknown,
  knownSkillIDs: ReadonlySet<string>,
): string => {
  const cleaned = sanitizeCompletedSkillID(raw);
  if (cleaned === undefined) return UNKNOWN_SKILL_ID;
  return knownSkillIDs.has(cleaned) ? cleaned : UNKNOWN_SKILL_ID;
};

const dedupeSkillIDs = (items: ReadonlyArray<unknown>): Array<string> => {
  const seen = new Set<string>();
  const out: Array<string> = [];
  for (const item of items) {
    if (!Predicate.isObject(item)) continue;
    const id = sanitizeCompletedSkillID((item as { id?: unknown }).id);
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
};

interface LocationRefLike {
  readonly directory: string;
  readonly workspaceID?: string | undefined;
}

const isDifferentLocation = (ctxLoc: LocationRefLike, eventLoc: LocationRefLike): boolean =>
  eventLoc.directory !== ctxLoc.directory || eventLoc.workspaceID !== ctxLoc.workspaceID;

interface ContextSnapshot {
  readonly userMessageIDs: ReadonlySet<string>;
  readonly skillToolResultCallIDs: ReadonlySet<string>;
  readonly priorAssistantIDs: ReadonlySet<string>;
  readonly at: number;
}

interface PendingPrompt {
  readonly skillIDs: ReadonlyArray<string>;
  readonly validated: boolean;
}

interface OpenSkillEntry {
  readonly loadID: string;
  readonly skill: string;
  readonly trigger: SkillTrigger;
  readonly turnID: string;
  readonly exposureKind: "tool-result" | "user-message";
  readonly exposureID: string;
}

interface LiveSessionState {
  readonly sessionID: string;
  projectID: string;
  currentTurnID: string;
  lastSettledStepID: string | undefined;
  partial: boolean;
  truncated: boolean;
  dirty: boolean;
  hasPersisted: boolean;
  updatedAt: number;
  readonly pendingPrompts: Map<string, PendingPrompt>;
  readonly contextQueue: Array<ContextSnapshot>;
  readonly openLoads: Array<OpenSkillEntry>;
  readonly pendingStepErrors: Map<string, number>;
  readonly pendingRetries: Map<string, number>;
  readonly settledSteps: Set<string>;
  readonly loadsById: Map<string, StoredSkillLoad>;
  readonly stepsById: Map<string, StoredAttributedStep>;
}

const createLiveTurnID = (executionEventID?: string): string =>
  executionEventID !== undefined && executionEventID.length > 0
    ? `live:${executionEventID}`
    : `live:${Bun.randomUUIDv7()}`;

const createSessionState = (
  sessionID: string,
  projectID: string,
  now: number,
  executionEventID?: string,
): LiveSessionState => ({
  sessionID,
  projectID,
  currentTurnID: createLiveTurnID(executionEventID),
  lastSettledStepID: undefined,
  partial: false,
  truncated: false,
  dirty: false,
  hasPersisted: false,
  updatedAt: now,
  pendingPrompts: new Map(),
  contextQueue: [],
  openLoads: [],
  pendingStepErrors: new Map(),
  pendingRetries: new Map(),
  settledSteps: new Set(),
  loadsById: new Map(),
  stepsById: new Map(),
});

const setBoundedMap = <V>(map: Map<string, V>, key: string, value: V, cap: number): void => {
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  while (map.size > cap) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
};

const addBoundedSet = (set: Set<string>, value: string, cap: number): void => {
  if (set.has(value)) set.delete(value);
  set.add(value);
  while (set.size > cap) {
    const oldest = set.values().next().value;
    if (oldest === undefined) break;
    set.delete(oldest);
  }
};

const parseStoredTokens = (raw: unknown): StoredTokens | undefined => {
  if (!Predicate.isObject(raw)) return undefined;
  const t = raw as {
    input?: unknown;
    output?: unknown;
    reasoning?: unknown;
    cache?: { read?: unknown; write?: unknown };
  };
  if (
    typeof t.input !== "number" ||
    typeof t.output !== "number" ||
    typeof t.reasoning !== "number" ||
    !Predicate.isObject(t.cache) ||
    typeof t.cache.read !== "number" ||
    typeof t.cache.write !== "number"
  ) {
    return undefined;
  }
  return {
    input: t.input,
    output: t.output,
    reasoning: t.reasoning,
    cacheRead: t.cache.read,
    cacheWrite: t.cache.write,
  };
};

const collectSkillResultCallIDs = (content: ReadonlyArray<unknown>, target: Set<string>): void => {
  for (const part of content) {
    if (!Predicate.isObject(part)) continue;
    const p = part as { type?: unknown; name?: unknown; id?: unknown; result?: unknown };
    if (p.type !== "tool-result" || p.name !== "skill" || typeof p.id !== "string") continue;
    const resultType = Predicate.isObject(p.result)
      ? (p.result as { type?: unknown }).type
      : undefined;
    if (resultType !== "error") target.add(p.id);
  }
};

const extractContextSnapshot = (messages: ReadonlyArray<unknown>, at: number): ContextSnapshot => {
  const userMessageIDs = new Set<string>();
  const skillToolResultCallIDs = new Set<string>();
  const priorAssistantIDs = new Set<string>();

  for (const msg of messages) {
    if (!Predicate.isObject(msg)) continue;
    const record = msg as { id?: unknown; role?: unknown; content?: unknown };
    if (record.role === "user" && typeof record.id === "string") {
      userMessageIDs.add(record.id);
      continue;
    }
    if (record.role === "assistant" && typeof record.id === "string") {
      priorAssistantIDs.add(record.id);
    }
    if ((record.role === "tool" || record.role === "assistant") && Array.isArray(record.content)) {
      collectSkillResultCallIDs(record.content, skillToolResultCallIDs);
    }
  }

  return { userMessageIDs, skillToolResultCallIDs, priorAssistantIDs, at };
};

const isNonSkillToolError = (event: {
  readonly tool: string;
  readonly status: "completed" | "error";
  readonly result?: Tool.Result;
}): boolean => {
  if (event.status === "error") return true;
  if (event.tool === "execute") {
    const metadata = event.result?.metadata as
      | { readonly error?: unknown; readonly toolCalls?: unknown }
      | undefined;
    return metadata?.error === true && countNestedToolErrors(metadata?.toolCalls) === 0;
  }
  if (event.tool === "shell") {
    const content = event.result?.content;
    return Array.isArray(content) && hasShellFailureOutput(content);
  }
  return false;
};

type HookAction =
  | { readonly kind: "exclude"; readonly sessionID: string }
  | {
      readonly kind: "hook.prompt";
      readonly sessionID: string;
      readonly messageID: string;
      readonly skillIDs: ReadonlyArray<string>;
      readonly at: number;
    }
  | {
      readonly kind: "hook.context";
      readonly sessionID: string;
      readonly snapshot: ContextSnapshot;
    }
  | {
      readonly kind: "hook.skill-tool";
      readonly sessionID: string;
      readonly messageID: string;
      readonly callID: string;
      readonly rawSkillID: unknown;
      readonly status: "completed" | "error";
      readonly at: number;
    }
  | {
      readonly kind: "hook.tool-error";
      readonly sessionID: string;
      readonly messageID: string;
    };

type BusAction =
  | {
      readonly kind: "bus.inbox.enqueued";
      readonly sessionID: string;
      readonly inboxID: string;
      readonly skillIDs: ReadonlyArray<string>;
      readonly location?: LocationRefLike;
      readonly at: number;
    }
  | {
      readonly kind: "bus.inbox.delivered";
      readonly sessionID: string;
      readonly inboxID: string;
      readonly location?: LocationRefLike;
      readonly at: number;
    }
  | {
      readonly kind: "bus.inbox.cancelled";
      readonly sessionID: string;
      readonly inboxID: string;
      readonly location?: LocationRefLike;
    }
  | {
      readonly kind: "bus.skill.activated";
      readonly sessionID: string;
      readonly eventID: string;
      readonly skillID: string;
      readonly location?: LocationRefLike;
      readonly at: number;
    }
  | {
      readonly kind: "bus.step.started";
      readonly sessionID: string;
      readonly agent: string;
      readonly location?: LocationRefLike;
    }
  | {
      readonly kind: "bus.step.settled";
      readonly sessionID: string;
      readonly assistantMessageID: string;
      readonly cost?: number;
      readonly tokens?: StoredTokens;
      readonly location?: LocationRefLike;
      readonly at: number;
    }
  | {
      readonly kind: "bus.retry.scheduled";
      readonly sessionID: string;
      readonly assistantMessageID: string;
      readonly location?: LocationRefLike;
    }
  | {
      readonly kind: "bus.compaction.ended";
      readonly sessionID: string;
      readonly location?: LocationRefLike;
      readonly at: number;
    }
  | {
      readonly kind: "bus.execution.started";
      readonly sessionID: string;
      readonly eventID?: string;
      readonly location?: LocationRefLike;
      readonly at: number;
    }
  | {
      readonly kind: "bus.execution.terminal";
      readonly sessionID: string;
      readonly outcome: "succeeded" | "failed" | "interrupted";
      readonly reason?: "user" | "shutdown" | "superseded" | "inactivity";
      readonly location?: LocationRefLike;
      readonly at: number;
    }
  | {
      readonly kind: "bus.moved";
      readonly sessionID: string;
      readonly projectID: string;
      readonly targetLocation: LocationRefLike;
      readonly at: number;
    }
  | {
      readonly kind: "bus.deleted";
      readonly sessionID: string;
      readonly location?: LocationRefLike;
    };

type TelemetryAction = HookAction | BusAction;

const TELEMETRY_EVENT_TYPES = [
  "session.inbox.enqueued",
  "session.inbox.delivered",
  "session.inbox.cancelled",
  "session.skill.activated",
  "session.step.started",
  "session.step.ended",
  "session.step.failed",
  "session.retry.scheduled",
  "session.compaction.ended",
  "session.execution.started",
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
  "session.moved",
  "session.deleted",
] as const;

const toLocationRef = (loc: unknown): LocationRefLike | undefined => {
  if (!Predicate.isObject(loc)) return undefined;
  const record = loc as { directory?: unknown; workspaceID?: unknown };
  if (typeof record.directory !== "string") return undefined;
  return {
    directory: record.directory,
    ...(typeof record.workspaceID === "string" ? { workspaceID: record.workspaceID } : {}),
  };
};

interface BusEnvelope {
  readonly id: unknown;
  readonly type: string;
  readonly sessionID: string;
  readonly location?: LocationRefLike;
  readonly at: number;
  readonly data: Record<string, unknown>;
}

const translateInboxEvent = (env: BusEnvelope): BusAction | undefined => {
  const inboxID = typeof env.data.inboxID === "string" ? env.data.inboxID : undefined;
  if (inboxID === undefined) return undefined;
  const loc = env.location === undefined ? {} : { location: env.location };
  if (env.type === "session.inbox.delivered") {
    return { kind: "bus.inbox.delivered", sessionID: env.sessionID, inboxID, ...loc, at: env.at };
  }
  if (env.type === "session.inbox.cancelled") {
    return { kind: "bus.inbox.cancelled", sessionID: env.sessionID, inboxID, ...loc };
  }
  if (!Predicate.isObject(env.data.item)) return undefined;
  const item = env.data.item as { type?: unknown; payload?: unknown };
  if (item.type !== "user" || !Predicate.isObject(item.payload)) return undefined;
  const payload = item.payload as { skills?: unknown };
  const skillIDs = Array.isArray(payload.skills) ? dedupeSkillIDs(payload.skills) : [];
  return {
    kind: "bus.inbox.enqueued",
    sessionID: env.sessionID,
    inboxID,
    skillIDs,
    ...loc,
    at: env.at,
  };
};

const translateStepEvent = (env: BusEnvelope): BusAction | undefined => {
  const loc = env.location === undefined ? {} : { location: env.location };
  if (env.type === "session.step.started") {
    const agent = typeof env.data.agent === "string" ? env.data.agent : undefined;
    return agent === undefined
      ? undefined
      : { kind: "bus.step.started", sessionID: env.sessionID, agent, ...loc };
  }
  const assistantMessageID =
    typeof env.data.assistantMessageID === "string" ? env.data.assistantMessageID : undefined;
  if (assistantMessageID === undefined) return undefined;
  if (env.type === "session.retry.scheduled") {
    return { kind: "bus.retry.scheduled", sessionID: env.sessionID, assistantMessageID, ...loc };
  }
  const cost =
    typeof env.data.cost === "number" && Number.isFinite(env.data.cost) ? env.data.cost : undefined;
  const tokens = parseStoredTokens(env.data.tokens);
  return {
    kind: "bus.step.settled",
    sessionID: env.sessionID,
    assistantMessageID,
    ...(cost === undefined ? {} : { cost }),
    ...(tokens === undefined ? {} : { tokens }),
    ...loc,
    at: env.at,
  };
};

const parseInterruptReason = (
  raw: unknown,
): "user" | "shutdown" | "superseded" | "inactivity" | undefined =>
  raw === "user" || raw === "shutdown" || raw === "superseded" || raw === "inactivity"
    ? raw
    : undefined;

const translateExecutionEvent = (env: BusEnvelope): BusAction | undefined => {
  const loc = env.location === undefined ? {} : { location: env.location };
  if (env.type === "session.execution.started") {
    const eventID = typeof env.id === "string" && env.id.length > 0 ? env.id : undefined;
    return {
      kind: "bus.execution.started",
      sessionID: env.sessionID,
      ...(eventID === undefined ? {} : { eventID }),
      ...loc,
      at: env.at,
    };
  }
  if (env.type === "session.execution.succeeded") {
    return {
      kind: "bus.execution.terminal",
      sessionID: env.sessionID,
      outcome: "succeeded",
      ...loc,
      at: env.at,
    };
  }
  if (env.type === "session.execution.failed") {
    return {
      kind: "bus.execution.terminal",
      sessionID: env.sessionID,
      outcome: "failed",
      ...loc,
      at: env.at,
    };
  }
  if (env.type === "session.execution.interrupted") {
    const reason = parseInterruptReason(env.data.reason);
    return {
      kind: "bus.execution.terminal",
      sessionID: env.sessionID,
      outcome: "interrupted",
      ...(reason === undefined ? {} : { reason }),
      ...loc,
      at: env.at,
    };
  }
  return undefined;
};

const translateSessionMetaEvent = (env: BusEnvelope): BusAction | undefined => {
  const loc = env.location === undefined ? {} : { location: env.location };
  if (env.type === "session.compaction.ended") {
    return { kind: "bus.compaction.ended", sessionID: env.sessionID, ...loc, at: env.at };
  }
  if (env.type === "session.deleted") {
    return { kind: "bus.deleted", sessionID: env.sessionID, ...loc };
  }
  if (env.type === "session.moved") {
    const projectID = typeof env.data.projectID === "string" ? env.data.projectID : undefined;
    const targetLocation = toLocationRef(env.data.location);
    if (projectID === undefined || targetLocation === undefined) return undefined;
    return { kind: "bus.moved", sessionID: env.sessionID, projectID, targetLocation, at: env.at };
  }
  return translateExecutionEvent(env);
};

const translateActivationEvent = (env: BusEnvelope): BusAction | undefined => {
  const eventID = typeof env.id === "string" ? env.id : undefined;
  const skillID = sanitizeCompletedSkillID(env.data.id);
  if (eventID === undefined || skillID === undefined) return undefined;
  return {
    kind: "bus.skill.activated",
    sessionID: env.sessionID,
    eventID,
    skillID,
    ...(env.location === undefined ? {} : { location: env.location }),
    at: env.at,
  };
};

const EVENT_TRANSLATORS: Readonly<Record<string, (env: BusEnvelope) => BusAction | undefined>> = {
  "session.inbox.enqueued": translateInboxEvent,
  "session.inbox.delivered": translateInboxEvent,
  "session.inbox.cancelled": translateInboxEvent,
  "session.skill.activated": translateActivationEvent,
  "session.step.started": translateStepEvent,
  "session.step.ended": translateStepEvent,
  "session.step.failed": translateStepEvent,
  "session.retry.scheduled": translateStepEvent,
  "session.compaction.ended": translateSessionMetaEvent,
  "session.execution.started": translateSessionMetaEvent,
  "session.execution.succeeded": translateSessionMetaEvent,
  "session.execution.failed": translateSessionMetaEvent,
  "session.execution.interrupted": translateSessionMetaEvent,
  "session.moved": translateSessionMetaEvent,
  "session.deleted": translateSessionMetaEvent,
};

const translateBusEvent = (event: unknown, now: () => number): BusAction | undefined => {
  if (!Predicate.isObject(event)) return undefined;
  const e = event as {
    id?: unknown;
    type?: unknown;
    created?: unknown;
    location?: unknown;
    data?: unknown;
  };
  if (typeof e.type !== "string" || !Predicate.isObject(e.data)) return undefined;
  const translator = EVENT_TRANSLATORS[e.type];
  if (translator === undefined) return undefined;
  const data = e.data as Record<string, unknown>;
  const sessionID = typeof data.sessionID === "string" ? data.sessionID : undefined;
  if (sessionID === undefined) return undefined;
  const location = toLocationRef(e.location);
  const at = typeof e.created === "number" && Number.isFinite(e.created) ? e.created : now();
  return translator({
    id: e.id,
    type: e.type,
    sessionID,
    at,
    data,
    ...(location === undefined ? {} : { location }),
  });
};

const putCappedEntry = <V>(
  map: Map<string, V>,
  key: string,
  value: V,
  cap: number,
  state: LiveSessionState,
  at: number,
  skipExisting: boolean,
): void => {
  if (skipExisting && map.has(key)) return;
  if (map.size >= cap && !map.has(key)) {
    state.truncated = true;
    state.partial = true;
    const oldestKey = map.keys().next().value;
    if (oldestKey !== undefined) map.delete(oldestKey);
  }
  map.set(key, value);
  state.updatedAt = Math.max(state.updatedAt, at);
  state.dirty = true;
};

const recordCompletedLoad = (state: LiveSessionState, entry: OpenSkillEntry, at: number): void => {
  putCappedEntry(
    state.loadsById,
    entry.loadID,
    {
      id: entry.loadID,
      turnID: entry.turnID,
      skill: entry.skill,
      trigger: entry.trigger,
      status: "completed",
      at,
    },
    MAX_LOADS_PER_SESSION,
    state,
    at,
    true,
  );
  state.openLoads.push(entry);
};

const promotePendingPrompt = (
  state: LiveSessionState,
  inboxID: string,
  at: number,
  knownSkillIDs: Set<string>,
): boolean => {
  const pending = state.pendingPrompts.get(inboxID);
  if (pending === undefined) return false;
  state.pendingPrompts.delete(inboxID);
  let added = false;
  for (const skill of pending.skillIDs) {
    knownSkillIDs.add(skill);
    recordCompletedLoad(
      state,
      {
        loadID: `prompt:${inboxID}:${skill}`,
        skill,
        trigger: "prompt-attachment",
        turnID: state.currentTurnID,
        exposureKind: "user-message",
        exposureID: inboxID,
      },
      at,
    );
    added = true;
  }
  return added;
};

const consumeSnapshotForStep = (
  state: LiveSessionState,
  assistantMessageID: string,
): ContextSnapshot | undefined => {
  const idx = state.contextQueue.findIndex((snap) =>
    snap.priorAssistantIDs.has(assistantMessageID),
  );
  if (idx > 0) {
    const chosen = state.contextQueue[idx - 1];
    state.contextQueue.splice(0, idx);
    return chosen;
  }
  if (idx === 0) {
    if (state.openLoads.length > 0) state.partial = true;
    return undefined;
  }
  const extraRetries = state.pendingRetries.get(assistantMessageID) ?? 0;
  const consumeCount = Math.min(state.contextQueue.length, 1 + extraRetries);
  if (consumeCount === 0) return undefined;
  const chosen = state.contextQueue[consumeCount - 1];
  state.contextQueue.splice(0, consumeCount);
  return chosen;
};

const eligibleSkillsForSnapshot = (
  openLoads: ReadonlyArray<OpenSkillEntry>,
  snapshot: ContextSnapshot,
): Array<string> => {
  const eligible = new Set<string>();
  for (const entry of openLoads) {
    if (
      entry.exposureKind === "tool-result" &&
      snapshot.skillToolResultCallIDs.has(entry.exposureID)
    ) {
      eligible.add(entry.skill);
    } else if (
      entry.exposureKind === "user-message" &&
      snapshot.userMessageIDs.has(entry.exposureID)
    ) {
      eligible.add(entry.skill);
    }
  }
  return [...eligible].toSorted();
};

const closeTurnWindow = (state: LiveSessionState, dropAbortedContext: boolean): void => {
  state.openLoads.length = 0;
  state.currentTurnID = createLiveTurnID();
  if (dropAbortedContext && state.contextQueue.length > 0) {
    const head = state.contextQueue[0];
    if (
      head !== undefined &&
      (state.lastSettledStepID === undefined ||
        !head.priorAssistantIDs.has(state.lastSettledStepID))
    ) {
      state.contextQueue.shift();
    }
  }
};

const toStorageRecord = (state: LiveSessionState): SessionTelemetryRecord => ({
  version: 1,
  projectID: state.projectID,
  sessionID: state.sessionID,
  updatedAt: state.updatedAt,
  partial: state.partial,
  truncated: state.truncated,
  loads: [...state.loadsById.values()],
  steps: [...state.stepsById.values()],
});

const decodeSessionID = Schema.decodeUnknownOption(Session.ID);

interface TelemetryRuntime {
  readonly ctx: Plugin.Context;
  readonly knownSkillIDs: Set<string>;
  readonly sessions: Map<string, LiveSessionState>;
  readonly ownedSessions: Set<string>;
  readonly excludedSessions: Set<string>;
  readonly deletedSessions: Set<string>;
  readonly droppedSessions: Set<string>;
}

const flushSession = (rt: TelemetryRuntime, state: LiveSessionState): Effect.Effect<void> => {
  if (!state.dirty || rt.deletedSessions.has(state.sessionID)) return Effect.void;
  if (state.loadsById.size === 0 && state.stepsById.size === 0) {
    state.dirty = false;
    return Effect.void;
  }
  state.dirty = false;
  const markPartialOnExisting = !state.hasPersisted;
  return writeSessionTelemetry(rt.ctx.storage, toStorageRecord(state), {
    markPartialOnExisting,
  }).pipe(
    Effect.tap((merged) =>
      Effect.sync(() => {
        if (merged !== undefined) {
          state.hasPersisted = true;
          if (merged.partial) state.partial = true;
        }
      }),
    ),
    Effect.asVoid,
  );
};

const evictOverflowSessions = (rt: TelemetryRuntime): Effect.Effect<void> =>
  Effect.gen(function* () {
    while (rt.sessions.size > MAX_TRACKED_SESSIONS) {
      const oldestKey = rt.sessions.keys().next().value;
      if (oldestKey === undefined) break;
      const evicted = rt.sessions.get(oldestKey);
      rt.sessions.delete(oldestKey);
      if (evicted === undefined || evicted.openLoads.length === 0) continue;
      evicted.partial = true;
      evicted.dirty = true;
      addBoundedSet(rt.droppedSessions, oldestKey, MAX_TRACKED_SESSIONS);
      yield* flushSession(rt, evicted);
    }
  });

const getOrCreateSession = (
  rt: TelemetryRuntime,
  sessionID: string,
  at: number,
  projectID: string = rt.ctx.location.project.id,
  executionEventID?: string,
): Effect.Effect<LiveSessionState> =>
  Effect.gen(function* () {
    const existing = rt.sessions.get(sessionID);
    if (existing !== undefined) {
      rt.sessions.delete(sessionID);
      rt.sessions.set(sessionID, existing);
      if (rt.droppedSessions.delete(sessionID)) {
        existing.partial = true;
        existing.dirty = true;
      }
      return existing;
    }
    const created = createSessionState(sessionID, projectID, at, executionEventID);
    if (rt.droppedSessions.delete(sessionID)) {
      created.partial = true;
      created.dirty = true;
    }
    rt.sessions.set(sessionID, created);
    yield* evictOverflowSessions(rt);
    return created;
  });

const excludeSession = (rt: TelemetryRuntime, sessionID: string): void => {
  addBoundedSet(rt.excludedSessions, sessionID, MAX_TRACKED_SESSIONS);
  rt.sessions.delete(sessionID);
  rt.ownedSessions.delete(sessionID);
};

const verifyLocationlessOwner = (
  rt: TelemetryRuntime,
  sessionID: string,
  allowLookup: boolean,
): Effect.Effect<{ readonly owned: boolean; readonly projectID?: string }> =>
  Effect.gen(function* () {
    if (rt.excludedSessions.has(sessionID) || rt.deletedSessions.has(sessionID)) {
      return { owned: false };
    }
    if (rt.sessions.has(sessionID) || rt.ownedSessions.has(sessionID)) {
      return { owned: true };
    }
    if (!allowLookup) return { owned: false };
    const parsed = Option.getOrUndefined(decodeSessionID(sessionID));
    if (parsed === undefined) return { owned: false };
    const infoRes = yield* Effect.result(rt.ctx.session.get({ sessionID: parsed })).pipe(
      Effect.timeoutOption("500 millis"),
      Effect.catchCause(() =>
        logTelemetryError("SESSION_LOOKUP_FAILED").pipe(Effect.as(Option.none())),
      ),
    );
    if (Option.isNone(infoRes) || Result.isFailure(infoRes.value)) {
      return { owned: false };
    }
    const info = infoRes.value.success;
    if (info.agent === "nocturna") {
      excludeSession(rt, sessionID);
      return { owned: false };
    }
    if (isDifferentLocation(rt.ctx.location, info.location)) {
      return { owned: false };
    }
    addBoundedSet(rt.ownedSessions, sessionID, MAX_TRACKED_SESSIONS);
    return { owned: true, projectID: info.projectID };
  });

const checkBusOwnership = (
  rt: TelemetryRuntime,
  sessionID: string,
  location: LocationRefLike | undefined,
  allowLookup: boolean,
): Effect.Effect<{ readonly owned: boolean; readonly projectID?: string }> => {
  if (rt.excludedSessions.has(sessionID) || rt.deletedSessions.has(sessionID)) {
    return Effect.succeed({ owned: false });
  }
  if (location !== undefined) {
    if (isDifferentLocation(rt.ctx.location, location)) {
      return Effect.succeed({ owned: false });
    }
    addBoundedSet(rt.ownedSessions, sessionID, MAX_TRACKED_SESSIONS);
    return Effect.succeed({ owned: true });
  }
  return verifyLocationlessOwner(rt, sessionID, allowLookup);
};

const applySkillToolHook = (
  rt: TelemetryRuntime,
  action: Extract<HookAction, { readonly kind: "hook.skill-tool" }>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    addBoundedSet(rt.ownedSessions, action.sessionID, MAX_TRACKED_SESSIONS);
    const state = yield* getOrCreateSession(rt, action.sessionID, action.at);
    if (action.status === "completed") {
      const skill = sanitizeCompletedSkillID(action.rawSkillID);
      if (skill === undefined) return;
      rt.knownSkillIDs.add(skill);
      recordCompletedLoad(
        state,
        {
          loadID: `tool:${action.callID}`,
          skill,
          trigger: "agent-tool",
          turnID: state.currentTurnID,
          exposureKind: "tool-result",
          exposureID: action.callID,
        },
        action.at,
      );
    } else {
      const skill = canonicalizeFailedSkillID(action.rawSkillID, rt.knownSkillIDs);
      putCappedEntry(
        state.loadsById,
        `tool:${action.callID}`,
        {
          id: `tool:${action.callID}`,
          turnID: state.currentTurnID,
          skill,
          trigger: "agent-tool",
          status: "error",
          at: action.at,
        },
        MAX_LOADS_PER_SESSION,
        state,
        action.at,
        true,
      );
    }
    yield* flushSession(rt, state);
  });

const applyStepSettled = (
  rt: TelemetryRuntime,
  action: Extract<BusAction, { readonly kind: "bus.step.settled" }>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const owner = yield* checkBusOwnership(rt, action.sessionID, action.location, false);
    if (!owner.owned) return;
    const state = rt.sessions.get(action.sessionID);
    if (state === undefined || state.settledSteps.has(action.assistantMessageID)) return;
    addBoundedSet(state.settledSteps, action.assistantMessageID, MAX_STEPS_PER_SESSION);
    state.lastSettledStepID = action.assistantMessageID;
    const snapshot = consumeSnapshotForStep(state, action.assistantMessageID);
    state.pendingRetries.delete(action.assistantMessageID);
    const stepErrors = state.pendingStepErrors.get(action.assistantMessageID) ?? 0;
    state.pendingStepErrors.delete(action.assistantMessageID);
    if (snapshot === undefined) return;
    for (const msgID of snapshot.userMessageIDs) {
      if (state.pendingPrompts.has(msgID)) {
        promotePendingPrompt(state, msgID, action.at, rt.knownSkillIDs);
      }
    }
    const eligible = eligibleSkillsForSnapshot(state.openLoads, snapshot);
    if (eligible.length === 0) return;
    const hasUsage = action.cost !== undefined && action.tokens !== undefined;
    putCappedEntry(
      state.stepsById,
      action.assistantMessageID,
      {
        assistantMessageID: action.assistantMessageID,
        turnID: state.currentTurnID,
        skills: eligible,
        ...(hasUsage ? { cost: action.cost, tokens: action.tokens } : {}),
        postLoadErrors: stepErrors,
      },
      MAX_STEPS_PER_SESSION,
      state,
      action.at,
      false,
    );
    yield* flushSession(rt, state);
  });

const applyMovedAction = (
  rt: TelemetryRuntime,
  action: Extract<BusAction, { readonly kind: "bus.moved" }>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const existing = rt.sessions.get(action.sessionID);
    if (existing !== undefined) {
      existing.projectID = action.projectID;
      existing.updatedAt = Math.max(existing.updatedAt, action.at);
      if (isDifferentLocation(rt.ctx.location, action.targetLocation)) {
        if (existing.openLoads.length > 0) existing.partial = true;
        existing.dirty = true;
        yield* flushSession(rt, existing);
        rt.sessions.delete(action.sessionID);
        rt.ownedSessions.delete(action.sessionID);
      } else {
        existing.dirty = true;
        yield* flushSession(rt, existing);
      }
      return;
    }
    if (!isDifferentLocation(rt.ctx.location, action.targetLocation)) {
      addBoundedSet(rt.ownedSessions, action.sessionID, MAX_TRACKED_SESSIONS);
    }
  });

const applyExecutionStarted = (
  rt: TelemetryRuntime,
  action: Extract<BusAction, { readonly kind: "bus.execution.started" }>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const owner = yield* checkBusOwnership(rt, action.sessionID, action.location, true);
    if (!owner.owned) return;
    const state = yield* getOrCreateSession(
      rt,
      action.sessionID,
      action.at,
      owner.projectID,
      action.eventID,
    );
    if (state.openLoads.length === 0) {
      state.currentTurnID = createLiveTurnID(action.eventID);
    }
  });

const applyTerminalAction = (
  rt: TelemetryRuntime,
  action: Extract<BusAction, { readonly kind: "bus.execution.terminal" }>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const owner = yield* checkBusOwnership(rt, action.sessionID, action.location, false);
    if (!owner.owned) return;
    const state = rt.sessions.get(action.sessionID);
    if (state === undefined) return;
    if (action.reason === "shutdown") {
      if (state.openLoads.length > 0 || state.loadsById.size > 0) {
        state.partial = true;
        state.dirty = true;
        state.updatedAt = Math.max(state.updatedAt, action.at);
        yield* flushSession(rt, state);
      }
      return;
    }
    closeTurnWindow(state, action.outcome !== "succeeded");
    yield* flushSession(rt, state);
  });

const applyHookAction = (rt: TelemetryRuntime, action: HookAction): Effect.Effect<void> => {
  if (action.kind === "exclude") {
    excludeSession(rt, action.sessionID);
    return Effect.void;
  }
  if (rt.excludedSessions.has(action.sessionID) || rt.deletedSessions.has(action.sessionID)) {
    return Effect.void;
  }
  if (action.kind === "hook.skill-tool") return applySkillToolHook(rt, action);
  if (action.kind === "hook.prompt") {
    return Effect.gen(function* () {
      addBoundedSet(rt.ownedSessions, action.sessionID, MAX_TRACKED_SESSIONS);
      const state = yield* getOrCreateSession(rt, action.sessionID, action.at);
      if (state.pendingPrompts.get(action.messageID)?.validated !== true) {
        setBoundedMap(
          state.pendingPrompts,
          action.messageID,
          { skillIDs: action.skillIDs, validated: false },
          MAX_BOUNDED_ENTRIES,
        );
      }
    });
  }
  if (action.kind === "hook.context") {
    return Effect.gen(function* () {
      addBoundedSet(rt.ownedSessions, action.sessionID, MAX_TRACKED_SESSIONS);
      const state = yield* getOrCreateSession(rt, action.sessionID, action.snapshot.at);
      if (state.contextQueue.length >= MAX_BOUNDED_ENTRIES) {
        state.contextQueue.shift();
        state.partial = true;
      }
      state.contextQueue.push(action.snapshot);
    });
  }
  const state = rt.sessions.get(action.sessionID);
  if (state === undefined) return Effect.void;
  const prev = state.pendingStepErrors.get(action.messageID) ?? 0;
  setBoundedMap(state.pendingStepErrors, action.messageID, prev + 1, MAX_BOUNDED_ENTRIES);
  return Effect.void;
};

const applyInboxAction = (
  rt: TelemetryRuntime,
  action: Extract<
    BusAction,
    { readonly kind: "bus.inbox.enqueued" | "bus.inbox.delivered" | "bus.inbox.cancelled" }
  >,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const owner = yield* checkBusOwnership(
      rt,
      action.sessionID,
      action.location,
      action.kind === "bus.inbox.enqueued",
    );
    if (!owner.owned) return;
    if (action.kind === "bus.inbox.cancelled") {
      rt.sessions.get(action.sessionID)?.pendingPrompts.delete(action.inboxID);
      return;
    }
    if (action.kind === "bus.inbox.enqueued") {
      const state = yield* getOrCreateSession(rt, action.sessionID, action.at, owner.projectID);
      for (const skill of action.skillIDs) rt.knownSkillIDs.add(skill);
      setBoundedMap(
        state.pendingPrompts,
        action.inboxID,
        { skillIDs: action.skillIDs, validated: true },
        MAX_BOUNDED_ENTRIES,
      );
      return;
    }
    const state = rt.sessions.get(action.sessionID);
    if (
      state !== undefined &&
      promotePendingPrompt(state, action.inboxID, action.at, rt.knownSkillIDs)
    ) {
      yield* flushSession(rt, state);
    }
  });

const applySkillActivated = (
  rt: TelemetryRuntime,
  action: Extract<BusAction, { readonly kind: "bus.skill.activated" }>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const owner = yield* checkBusOwnership(rt, action.sessionID, action.location, true);
    if (!owner.owned) return;
    const state = yield* getOrCreateSession(rt, action.sessionID, action.at, owner.projectID);
    rt.knownSkillIDs.add(action.skillID);
    const messageID = action.eventID.replace(/^evt_/, "msg_");
    recordCompletedLoad(
      state,
      {
        loadID: `act:${messageID}`,
        skill: action.skillID,
        trigger: "api-activation",
        turnID: state.currentTurnID,
        exposureKind: "user-message",
        exposureID: messageID,
      },
      action.at,
    );
    yield* flushSession(rt, state);
  });

const applyRetryScheduled = (
  rt: TelemetryRuntime,
  action: Extract<BusAction, { readonly kind: "bus.retry.scheduled" }>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const owner = yield* checkBusOwnership(rt, action.sessionID, action.location, false);
    if (!owner.owned) return;
    const state = rt.sessions.get(action.sessionID);
    if (state === undefined || state.settledSteps.has(action.assistantMessageID)) return;
    const prev = state.pendingRetries.get(action.assistantMessageID) ?? 0;
    setBoundedMap(state.pendingRetries, action.assistantMessageID, prev + 1, MAX_BOUNDED_ENTRIES);
  });

const applyCompactionEnded = (
  rt: TelemetryRuntime,
  action: Extract<BusAction, { readonly kind: "bus.compaction.ended" }>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const owner = yield* checkBusOwnership(rt, action.sessionID, action.location, false);
    if (!owner.owned) return;
    const state = rt.sessions.get(action.sessionID);
    if (state === undefined) return;
    closeTurnWindow(state, false);
    yield* flushSession(rt, state);
  });

const applyBusAction = (rt: TelemetryRuntime, action: BusAction): Effect.Effect<void> => {
  if (action.kind === "bus.deleted") {
    if (action.location !== undefined && isDifferentLocation(rt.ctx.location, action.location)) {
      return Effect.void;
    }
    rt.sessions.delete(action.sessionID);
    rt.ownedSessions.delete(action.sessionID);
    addBoundedSet(rt.deletedSessions, action.sessionID, MAX_TRACKED_SESSIONS);
    return deleteSessionTelemetry(rt.ctx.storage, action.sessionID);
  }
  if (action.kind === "bus.moved") return applyMovedAction(rt, action);
  if (rt.excludedSessions.has(action.sessionID) || rt.deletedSessions.has(action.sessionID)) {
    return Effect.void;
  }
  switch (action.kind) {
    case "bus.inbox.enqueued":
    case "bus.inbox.delivered":
    case "bus.inbox.cancelled":
      return applyInboxAction(rt, action);
    case "bus.skill.activated":
      return applySkillActivated(rt, action);
    case "bus.step.started":
      if (action.agent === "nocturna") excludeSession(rt, action.sessionID);
      return Effect.void;
    case "bus.retry.scheduled":
      return applyRetryScheduled(rt, action);
    case "bus.step.settled":
      return applyStepSettled(rt, action);
    case "bus.compaction.ended":
      return applyCompactionEnded(rt, action);
    case "bus.execution.started":
      return applyExecutionStarted(rt, action);
    case "bus.execution.terminal":
      return applyTerminalAction(rt, action);
  }
};

const processAction = (rt: TelemetryRuntime, action: TelemetryAction): Effect.Effect<void> =>
  action.kind === "exclude" || action.kind.startsWith("hook.")
    ? applyHookAction(rt, action as HookAction)
    : applyBusAction(rt, action as BusAction);

const hydrateKnownSkills = (rt: TelemetryRuntime): Effect.Effect<void> =>
  Effect.suspend(() => {
    const list = rt.ctx.skill?.list;
    if (typeof list !== "function") return Effect.void;
    return list().pipe(
      Effect.timeoutOption("500 millis"),
      Effect.tap((maybeSkills) =>
        Effect.sync(() => {
          if (Option.isNone(maybeSkills)) return;
          for (const skill of maybeSkills.value.data) {
            const id = sanitizeCompletedSkillID(skill.id);
            if (id !== undefined) rt.knownSkillIDs.add(id);
          }
        }),
      ),
      Effect.asVoid,
    );
  }).pipe(Effect.catchCause(() => logTelemetryError("SKILL_LIST_FAILED")));

const flushAllOnShutdown = (rt: TelemetryRuntime): Effect.Effect<void> =>
  Effect.gen(function* () {
    for (const state of rt.sessions.values()) {
      if (rt.deletedSessions.has(state.sessionID)) continue;
      if (state.openLoads.length > 0) {
        state.partial = true;
        state.dirty = true;
      }
      yield* flushSession(rt, state);
    }
    rt.sessions.clear();
  }).pipe(Effect.catchCause(() => logTelemetryError("FINALIZER_FLUSH_FAILED")));

const attachBusSubscriber = (
  ctx: Plugin.Context,
  clock: () => number,
  offerAction: (action: TelemetryAction) => void,
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.suspend(() => {
    const subscribe = ctx.event?.subscribe;
    if (typeof subscribe !== "function") return Effect.void;
    return subscribe({ types: TELEMETRY_EVENT_TYPES }).pipe(
      Stream.runForEach((event) =>
        Effect.suspend(() => {
          const action = translateBusEvent(event, clock);
          if (action !== undefined) offerAction(action);
          return Effect.void;
        }).pipe(Effect.catchCause(() => logTelemetryError("BUS_EVENT_FAILED"))),
      ),
    );
  }).pipe(
    Effect.catchCause(() => logTelemetryError("BUS_STREAM_FAILED")),
    Effect.forkScoped({ startImmediately: true }),
    Effect.asVoid,
  );

const attachSessionAndToolHooks = (
  rt: TelemetryRuntime,
  clock: () => number,
  offerAction: (action: TelemetryAction) => void,
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    yield* rt.ctx.session.hook("prompt", (event) =>
      Effect.suspend(() => {
        const sessionID = event.sessionID as string;
        if (rt.excludedSessions.has(sessionID)) return Effect.void;
        const rawSkills = event.prompt?.skills;
        if (!Array.isArray(rawSkills) || rawSkills.length === 0) return Effect.void;
        const skillIDs = dedupeSkillIDs(rawSkills);
        if (skillIDs.length > 0) {
          offerAction({
            kind: "hook.prompt",
            sessionID,
            messageID: event.messageID as string,
            skillIDs,
            at: clock(),
          });
        }
        return Effect.void;
      }).pipe(Effect.catchCause(() => logTelemetryError("HOOK_PROMPT_FAILED"))),
    );

    yield* rt.ctx.session.hook("context", (event) =>
      Effect.suspend(() => {
        const sessionID = event.sessionID as string;
        if (event.agent === "nocturna") {
          offerAction({ kind: "exclude", sessionID });
          return Effect.void;
        }
        offerAction({
          kind: "hook.context",
          sessionID,
          snapshot: extractContextSnapshot(event.messages, clock()),
        });
        return Effect.void;
      }).pipe(Effect.catchCause(() => logTelemetryError("HOOK_CONTEXT_FAILED"))),
    );

    yield* rt.ctx.tool.hook("execute.after", (event) =>
      Effect.suspend(() => {
        const sessionID = event.sessionID as string;
        if (event.agent === "nocturna") {
          offerAction({ kind: "exclude", sessionID });
          return Effect.void;
        }
        if (event.tool === "skill") {
          const rawSkillID = Predicate.isObject(event.input)
            ? (event.input as { id?: unknown }).id
            : undefined;
          offerAction({
            kind: "hook.skill-tool",
            sessionID,
            messageID: event.messageID as string,
            callID: event.id as string,
            rawSkillID,
            status: event.status,
            at: clock(),
          });
          return Effect.void;
        }
        if (
          isNonSkillToolError({
            tool: event.tool,
            status: event.status,
            ...(event.status === "completed" ? { result: event.result } : {}),
          })
        ) {
          offerAction({
            kind: "hook.tool-error",
            sessionID,
            messageID: event.messageID as string,
          });
        }
        return Effect.void;
      }).pipe(Effect.catchCause(() => logTelemetryError("HOOK_TOOL_AFTER_FAILED"))),
    );
  });

export const attachSkillTelemetry = (
  ctx: Plugin.Context,
  clock: () => number = Date.now,
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    const queue = yield* Queue.dropping<TelemetryAction, Cause.Done>(QUEUE_CAPACITY);
    const rt: TelemetryRuntime = {
      ctx,
      knownSkillIDs: new Set<string>(KNOWN_SPECTRE_SKILL_IDS),
      sessions: new Map(),
      ownedSessions: new Set(),
      excludedSessions: new Set(),
      deletedSessions: new Set(),
      droppedSessions: new Set(),
    };

    const consumerFiber = yield* Effect.gen(function* () {
      yield* hydrateKnownSkills(rt);
      while (true) {
        const next = yield* Queue.take(queue).pipe(
          Effect.catchIf(Cause.isDone, () => Effect.succeed(undefined)),
        );
        if (next === undefined) break;
        yield* processAction(rt, next).pipe(
          Effect.catchCause(() => logTelemetryError("EVENT_HANDLE_FAILED")),
        );
      }
      yield* flushAllOnShutdown(rt);
    }).pipe(Effect.forkScoped({ startImmediately: true }));

    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        yield* Queue.end(queue);
        yield* Fiber.await(consumerFiber).pipe(Effect.timeoutOption("500 millis"));
      }).pipe(Effect.catchCause(() => logTelemetryError("FINALIZER_FAILED"))),
    );

    const offerAction = (action: TelemetryAction): void => {
      if (!Queue.offerUnsafe(queue, action)) {
        addBoundedSet(rt.droppedSessions, action.sessionID, MAX_TRACKED_SESSIONS);
      }
    };

    yield* attachBusSubscriber(ctx, clock, offerAction);
    yield* attachSessionAndToolHooks(rt, clock, offerAction);
    yield* Effect.logInfo("Registered nocturna skill telemetry", { code: "TELEMETRY_ATTACHED" });
  });
