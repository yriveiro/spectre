import type { Plugin } from "@opencode/plugin/effect";
import { Effect, Option, Schema } from "effect";

export const TELEMETRY_KEY_PREFIX = "nocturna:skill:v1:";
export const TELEMETRY_RETENTION_MS = 90 * 24 * 60 * 60 * 1_000;
export const MAX_TELEMETRY_SESSIONS = 2_000;
export const MAX_LOADS_PER_SESSION = 64;
export const MAX_STEPS_PER_SESSION = 256;
export const PRUNE_INTERVAL_MS = 60 * 60 * 1_000;
export const UNKNOWN_SKILL_ID = "<unknown>";

const SCAN_PAGE_SIZE = 200;
const MAX_SCAN_PAGES = 50;

export const SkillTriggerSchema = Schema.Literals([
  "agent-tool",
  "prompt-attachment",
  "api-activation",
]);
export type SkillTrigger = typeof SkillTriggerSchema.Type;

export const StoredTokensSchema = Schema.Struct({
  input: Schema.Number,
  output: Schema.Number,
  reasoning: Schema.Number,
  cacheRead: Schema.Number,
  cacheWrite: Schema.Number,
});
export type StoredTokens = typeof StoredTokensSchema.Type;

export const StoredSkillLoadSchema = Schema.Struct({
  id: Schema.String,
  turnID: Schema.String,
  skill: Schema.String,
  trigger: SkillTriggerSchema,
  status: Schema.Literals(["completed", "error"]),
  at: Schema.Number,
});
export type StoredSkillLoad = typeof StoredSkillLoadSchema.Type;

export const StoredAttributedStepSchema = Schema.Struct({
  assistantMessageID: Schema.String,
  turnID: Schema.String,
  skills: Schema.Array(Schema.String),
  cost: Schema.optional(Schema.Number),
  tokens: Schema.optional(StoredTokensSchema),
  postLoadErrors: Schema.Int,
});
export type StoredAttributedStep = typeof StoredAttributedStepSchema.Type;

export const SessionTelemetryRecordSchema = Schema.Struct({
  version: Schema.Literals([1]),
  projectID: Schema.String,
  sessionID: Schema.String,
  updatedAt: Schema.Number,
  partial: Schema.Boolean,
  truncated: Schema.Boolean,
  loads: Schema.Array(StoredSkillLoadSchema),
  steps: Schema.Array(StoredAttributedStepSchema),
});
export type SessionTelemetryRecord = typeof SessionTelemetryRecordSchema.Type;

const decodeRecord = Schema.decodeUnknownOption(SessionTelemetryRecordSchema);
const encodeRecord = Schema.encodeSync(SessionTelemetryRecordSchema);

export const telemetryStorageKey = (sessionID: string): string =>
  `${TELEMETRY_KEY_PREFIX}${sessionID}`;

export const logTelemetryError = (code: string): Effect.Effect<void> =>
  Effect.logWarning("nocturna telemetry error", { code }).pipe(Effect.asVoid);

export const mergeAttributedStep = (
  existing: StoredAttributedStep,
  incoming: StoredAttributedStep,
): StoredAttributedStep => {
  const skills = [...new Set([...existing.skills, ...incoming.skills])].toSorted();
  const cost = incoming.cost ?? existing.cost;
  const tokens = incoming.tokens ?? existing.tokens;
  const hasUsage = cost !== undefined && tokens !== undefined;
  return {
    assistantMessageID: existing.assistantMessageID,
    turnID: existing.turnID,
    skills,
    ...(hasUsage ? { cost, tokens } : {}),
    postLoadErrors: Math.max(existing.postLoadErrors, incoming.postLoadErrors),
  };
};

const mergeByKey = <T>(
  existing: ReadonlyArray<T>,
  incoming: ReadonlyArray<T>,
  keyOf: (item: T) => string,
  combine: (prev: T, next: T) => T,
  cap: number,
  sort?: (left: T, right: T) => number,
): { readonly items: Array<T>; readonly truncated: boolean } => {
  const byId = new Map<string, T>();
  for (const item of existing) byId.set(keyOf(item), item);
  for (const item of incoming) {
    const key = keyOf(item);
    const prev = byId.get(key);
    byId.set(key, prev === undefined ? item : combine(prev, item));
  }
  const all = [...byId.values()];
  if (all.length <= cap) return { items: all, truncated: false };
  const ordered = sort === undefined ? all : all.toSorted(sort);
  return { items: ordered.slice(-cap), truncated: true };
};

export const mergeSessionTelemetry = (
  existing: SessionTelemetryRecord,
  incoming: SessionTelemetryRecord,
): SessionTelemetryRecord => {
  const loads = mergeByKey(
    existing.loads,
    incoming.loads,
    (item) => item.id,
    (prev) => prev,
    MAX_LOADS_PER_SESSION,
    (left, right) => left.at - right.at,
  );
  const steps = mergeByKey(
    existing.steps,
    incoming.steps,
    (step) => step.assistantMessageID,
    mergeAttributedStep,
    MAX_STEPS_PER_SESSION,
  );
  const truncated = existing.truncated || incoming.truncated || loads.truncated || steps.truncated;
  return {
    version: 1,
    projectID: incoming.projectID,
    sessionID: incoming.sessionID,
    updatedAt: Math.max(existing.updatedAt, incoming.updatedAt),
    partial: existing.partial || incoming.partial || truncated,
    truncated,
    loads: loads.items,
    steps: steps.items,
  };
};

export const readSessionTelemetry = (
  storage: Plugin.Context["storage"],
  sessionID: string,
): Effect.Effect<SessionTelemetryRecord | undefined> =>
  Effect.suspend(() =>
    storage.get(telemetryStorageKey(sessionID)).pipe(
      Effect.map((raw) => Option.getOrUndefined(decodeRecord(raw))),
    ),
  ).pipe(
    Effect.catchCause(() => logTelemetryError("STORAGE_READ_FAILED").pipe(Effect.as(undefined))),
  );

export const writeSessionTelemetry = (
  storage: Plugin.Context["storage"],
  record: SessionTelemetryRecord,
): Effect.Effect<void> =>
  Effect.suspend(() =>
    Effect.gen(function* () {
      const key = telemetryStorageKey(record.sessionID);
      const raw = yield* storage.get(key);
      const existing = Option.getOrUndefined(decodeRecord(raw));
      const merged = existing === undefined ? record : mergeSessionTelemetry(existing, record);
      const encoded = encodeRecord(merged) as unknown as Schema.Json;
      yield* storage.set(key, encoded);
    }),
  ).pipe(Effect.catchCause(() => logTelemetryError("STORAGE_WRITE_FAILED")));

export const deleteSessionTelemetry = (
  storage: Plugin.Context["storage"],
  sessionID: string,
): Effect.Effect<void> =>
  Effect.suspend(() => storage.remove(telemetryStorageKey(sessionID))).pipe(
    Effect.catchCause(() => logTelemetryError("STORAGE_DELETE_FAILED")),
  );

const lastPruneByStorage = new WeakMap<object, Map<string, number>>();

export interface PruneOptions {
  readonly maxSessions?: number;
  readonly retentionMs?: number;
  readonly force?: boolean;
}

const shouldSkipPrune = (
  storage: object,
  projectID: string,
  now: number,
  force: boolean,
): boolean => {
  let projectMap = lastPruneByStorage.get(storage);
  if (projectMap === undefined) {
    projectMap = new Map<string, number>();
    lastPruneByStorage.set(storage, projectMap);
  }
  const prevPrune = projectMap.get(projectID);
  if (!force && prevPrune !== undefined && now - prevPrune < PRUNE_INTERVAL_MS) {
    return true;
  }
  projectMap.set(projectID, now);
  return false;
};

const collectExpiredAndProjectRows = (
  storage: Plugin.Context["storage"],
  projectID: string,
  cutoff: number,
) =>
  Effect.gen(function* () {
    const toRemove: Array<string> = [];
    const projectRows: Array<{ readonly key: string; readonly updatedAt: number }> = [];
    let after: string | undefined;

    for (let page = 0; page < MAX_SCAN_PAGES; page += 1) {
      const result = yield* storage.scan({
        prefix: TELEMETRY_KEY_PREFIX,
        ...(after === undefined ? {} : { after }),
        limit: SCAN_PAGE_SIZE,
      });
      for (const entry of result.entries) {
        const decoded = Option.getOrUndefined(decodeRecord(entry.value));
        if (decoded === undefined || decoded.updatedAt < cutoff) {
          toRemove.push(entry.key);
        } else if (decoded.projectID === projectID) {
          projectRows.push({ key: entry.key, updatedAt: decoded.updatedAt });
        }
      }
      if (result.next === undefined || result.entries.length === 0) break;
      after = result.next;
    }

    return { toRemove, projectRows };
  });

export const pruneSkillTelemetry = (
  storage: Plugin.Context["storage"],
  projectID: string,
  now: number,
  options: PruneOptions = {},
): Effect.Effect<void> =>
  Effect.suspend(() =>
    Effect.gen(function* () {
      if (shouldSkipPrune(storage, projectID, now, options.force === true)) return;
      const maxSessions = options.maxSessions ?? MAX_TELEMETRY_SESSIONS;
      const cutoff = now - (options.retentionMs ?? TELEMETRY_RETENTION_MS);
      const { toRemove, projectRows } = yield* collectExpiredAndProjectRows(
        storage,
        projectID,
        cutoff,
      );
      if (projectRows.length > maxSessions) {
        const sorted = projectRows.toSorted((left, right) => right.updatedAt - left.updatedAt);
        for (const extra of sorted.slice(maxSessions)) toRemove.push(extra.key);
      }
      for (const key of toRemove) yield* storage.remove(key);
    }),
  ).pipe(Effect.catchCause(() => logTelemetryError("STORAGE_PRUNE_FAILED")));
