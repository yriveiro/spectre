import type { Plugin } from "@opencode/plugin/effect";
import { Effect, Option, Schema, Semaphore } from "effect";
import {
  compareGroupOrder,
  type FoldedGroup,
  foldEvents,
  type OccurrenceRecord,
  OccurrenceRecordSchema,
  type StateEventRecord,
  StateEventRecordSchema,
  TargetKindSchema,
} from "./fold";
import { FIELD_LIMITS, sanitizeDisplay } from "./redact";

export const STATE_PREFIX = "papercut:v1:s:";
export const OCCURRENCE_PREFIX = "papercut:v1:o:";

export const DEFAULT_STATE_SCAN_CAP = 2_000;
export const DEFAULT_OCCURRENCE_SCAN_CAP = 4_000;
export const MAX_OCCURRENCES_PER_CYCLE = 50;
export const RESOLVED_RETENTION_MS = 90 * 24 * 60 * 60 * 1_000;
const MAX_PRUNE_GROUPS_PER_CALL = 5;
const MAX_RECOVERY_PRUNE_GROUPS = 20;
const MAX_RECOVERY_STATE_SCAN_CAP = 10_000;
const MAX_RECOVERY_OCCURRENCE_SCAN_CAP = 20_000;
const STATE_RESOLVE_HEADROOM = 64;
const OCCURRENCE_WRITE_HEADROOM = 32;
const STORAGE_PAGE_LIMIT = 1_000;

const reserveWriteHeadroom = (cap: number, ratio: number, maxHeadroom: number): number =>
  cap - Math.min(maxHeadroom, Math.max(1, Math.floor(cap * ratio)));

export const logOccurrenceWriteCap = (occurrenceCap: number): number =>
  occurrenceCap <= 3
    ? occurrenceCap
    : reserveWriteHeadroom(occurrenceCap, 0.05, OCCURRENCE_WRITE_HEADROOM);

export const logStateWriteCap = (stateCap: number): number =>
  stateCap <= 1 ? 0 : reserveWriteHeadroom(stateCap, 0.1, STATE_RESOLVE_HEADROOM);

export const writeLock = Semaphore.makeUnsafe(1);

const decodeOccurrence = Schema.decodeUnknownOption(OccurrenceRecordSchema);
const decodeState = Schema.decodeUnknownOption(StateEventRecordSchema);

export interface PapercutsStoreOptions {
  readonly stateScanCap?: number;
  readonly occurrenceScanCap?: number;
}

export interface PapercutsRollupOptions extends PapercutsStoreOptions {
  readonly limit?: number;
}

export const PapercutRollupGroupSchema = Schema.Struct({
  groupId: Schema.String,
  targetKind: TargetKindSchema,
  target: Schema.String,
  projects: Schema.Int,
  occurrences: Schema.Int,
  reopened: Schema.Boolean,
});

export const PapercutRollupSchema = Schema.Struct({
  status: Schema.Literals(["ok", "unavailable"]),
  openGroups: Schema.Int,
  newReportsInWindow: Schema.Int,
  scanTruncated: Schema.Boolean,
  topGroups: Schema.Array(PapercutRollupGroupSchema),
});
export type PapercutRollup = typeof PapercutRollupSchema.Type;

const UNAVAILABLE_ROLLUP: PapercutRollup = {
  status: "unavailable",
  openGroups: 0,
  newReportsInWindow: 0,
  scanTruncated: false,
  topGroups: [],
};

interface RawScanResult {
  readonly entries: ReadonlyArray<{ readonly key: string; readonly value: Schema.Json }>;
  readonly truncated: boolean;
}

const scanPrefix = (
  storage: Plugin.Context["storage"],
  prefix: string,
  cap: number,
): Effect.Effect<RawScanResult> =>
  Effect.gen(function* () {
    const entries: Array<{ readonly key: string; readonly value: Schema.Json }> = [];
    let after: string | undefined;

    while (entries.length < cap) {
      const remaining = cap - entries.length;
      const page = yield* storage.scan({
        prefix,
        ...(after === undefined ? {} : { after }),
        limit: Math.min(STORAGE_PAGE_LIMIT, remaining),
      });
      entries.push(...page.entries);
      if (page.next === undefined || page.entries.length === 0) {
        return { entries, truncated: false };
      }
      after = page.next;
    }

    return { entries, truncated: true };
  });

export interface LoadedStore {
  readonly groups: ReadonlyMap<string, FoldedGroup>;
  readonly scanTruncated: boolean;
  readonly stateTruncated: boolean;
  readonly occurrenceTruncated: boolean;
  readonly stateCount: number;
  readonly occurrenceCount: number;
  readonly stateCap: number;
  readonly occurrenceCap: number;
  readonly problems: ReadonlyArray<string>;
}

const decodeEntries = <T extends { readonly id: string }>(
  entries: ReadonlyArray<{ readonly key: string; readonly value: Schema.Json }>,
  decode: (value: unknown) => Option.Option<T>,
): {
  readonly records: Array<T>;
  readonly keysById: Map<string, string>;
  readonly malformed: number;
} => {
  const records: Array<T> = [];
  const keysById = new Map<string, string>();
  let malformed = 0;

  for (const entry of entries) {
    const decoded = Option.getOrUndefined(decode(entry.value));
    if (decoded === undefined) {
      malformed += 1;
    } else {
      records.push(decoded);
      keysById.set(decoded.id, entry.key);
    }
  }

  return { records, keysById, malformed };
};

export const loadStore = (
  storage: Plugin.Context["storage"],
  options: PapercutsStoreOptions = {},
): Effect.Effect<LoadedStore> =>
  Effect.gen(function* () {
    const stateCap = Math.max(1, options.stateScanCap ?? DEFAULT_STATE_SCAN_CAP);
    const occurrenceCap = Math.max(1, options.occurrenceScanCap ?? DEFAULT_OCCURRENCE_SCAN_CAP);

    const stateScan = yield* scanPrefix(storage, STATE_PREFIX, stateCap);
    const occurrenceScan = yield* scanPrefix(storage, OCCURRENCE_PREFIX, occurrenceCap);

    const states = decodeEntries(stateScan.entries, decodeState);
    const occurrences = decodeEntries(occurrenceScan.entries, decodeOccurrence);

    const folded = foldEvents(
      occurrences.records,
      states.records,
      occurrences.keysById,
      states.keysById,
    );
    const problems = [...folded.problems];
    if (occurrences.malformed > 0) {
      problems.push(`Skipped ${occurrences.malformed} malformed papercut occurrence row(s).`);
    }
    if (states.malformed > 0) {
      problems.push(`Skipped ${states.malformed} malformed papercut state row(s).`);
    }

    return {
      groups: folded.groups,
      scanTruncated: stateScan.truncated || occurrenceScan.truncated,
      stateTruncated: stateScan.truncated,
      occurrenceTruncated: occurrenceScan.truncated,
      stateCount: stateScan.entries.length,
      occurrenceCount: occurrenceScan.entries.length,
      stateCap,
      occurrenceCap,
      problems,
    };
  });

export const persistEvent = (
  storage: Plugin.Context["storage"],
  kind: "occurrence" | "state",
  record: OccurrenceRecord | StateEventRecord,
): Effect.Effect<void> =>
  storage.set(`${kind === "occurrence" ? OCCURRENCE_PREFIX : STATE_PREFIX}${record.id}`, record);

const deleteExpiredResolvedGroups = (
  storage: Plugin.Context["storage"],
  groups: ReadonlyMap<string, FoldedGroup>,
  now: number,
  excludeGroupId: string | undefined,
  maxGroups: number,
): Effect.Effect<number> =>
  Effect.gen(function* () {
    const expired = [...groups.values()]
      .filter(
        (group) =>
          group.groupId !== excludeGroupId &&
          group.status === "resolved" &&
          group.resolvedAt !== undefined &&
          now - group.resolvedAt > RESOLVED_RETENTION_MS &&
          group.occurrenceKeys.length === group.occurrences &&
          group.stateKeys.length > 0,
      )
      .toSorted((left, right) => (left.resolvedAt ?? 0) - (right.resolvedAt ?? 0))
      .slice(0, maxGroups);

    let pruned = 0;
    for (const group of expired) {
      for (const key of group.occurrenceKeys) {
        yield* storage.remove(key);
        pruned += 1;
      }
      for (const key of group.stateKeys) {
        yield* storage.remove(key);
        pruned += 1;
      }
    }

    return pruned;
  });

export const pruneExpiredResolvedGroups = (
  storage: Plugin.Context["storage"],
  loaded: LoadedStore,
  now: number,
  excludeGroupId?: string,
): Effect.Effect<number> =>
  loaded.scanTruncated
    ? Effect.succeed(0)
    : deleteExpiredResolvedGroups(
        storage,
        loaded.groups,
        now,
        excludeGroupId,
        MAX_PRUNE_GROUPS_PER_CALL,
      );

export const pruneExpiredResolvedForRecovery = (
  storage: Plugin.Context["storage"],
  loaded: LoadedStore,
  now: number,
  excludeGroupId?: string,
): Effect.Effect<number> =>
  Effect.gen(function* () {
    if (!loaded.scanTruncated) {
      return yield* deleteExpiredResolvedGroups(
        storage,
        loaded.groups,
        now,
        excludeGroupId,
        MAX_RECOVERY_PRUNE_GROUPS,
      );
    }

    const recovery = yield* loadStore(storage, {
      stateScanCap: Math.max(loaded.stateCap, MAX_RECOVERY_STATE_SCAN_CAP),
      occurrenceScanCap: Math.max(loaded.occurrenceCap, MAX_RECOVERY_OCCURRENCE_SCAN_CAP),
    });
    if (recovery.scanTruncated) return 0;

    return yield* deleteExpiredResolvedGroups(
      storage,
      recovery.groups,
      now,
      excludeGroupId,
      MAX_RECOVERY_PRUNE_GROUPS,
    );
  });

export const summarizeOpenPapercuts = (
  ctx: Plugin.Context,
  cutoffAt: number,
  options: PapercutsRollupOptions = {},
): Effect.Effect<PapercutRollup> =>
  loadStore(ctx.storage, options).pipe(
    Effect.map((loaded): PapercutRollup => {
      const open = [...loaded.groups.values()]
        .filter((group) => group.status === "open")
        .toSorted(compareGroupOrder);

      let newReportsInWindow = 0;
      for (const group of open) {
        for (const occ of group.occurrenceRecords) {
          if (occ.at >= cutoffAt) newReportsInWindow += 1;
        }
      }

      const limit = Math.max(1, Math.min(50, Math.trunc(options.limit ?? 15)));
      const topGroups = open.slice(0, limit).map((group) => ({
        groupId: group.groupId,
        targetKind: group.targetKind,
        target: sanitizeDisplay(group.target, FIELD_LIMITS.target),
        projects: group.projects,
        occurrences: group.occurrences,
        reopened: group.reopened,
      }));

      return {
        status: "ok",
        openGroups: open.length,
        newReportsInWindow,
        scanTruncated: loaded.scanTruncated,
        topGroups,
      };
    }),
    Effect.catchCause(() => Effect.succeed(UNAVAILABLE_ROLLUP)),
  );
