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
import { escapeUntrusted } from "./redact";

export const STATE_PREFIX = "papercut:v1:s:";
export const OCCURRENCE_PREFIX = "papercut:v1:o:";

export const DEFAULT_STATE_SCAN_CAP = 2_000;
export const DEFAULT_OCCURRENCE_SCAN_CAP = 4_000;
export const MAX_OCCURRENCES_PER_CYCLE = 50;
export const RESOLVED_RETENTION_MS = 90 * 24 * 60 * 60 * 1_000;
const MAX_PRUNE_GROUPS_PER_CALL = 5;
const STORAGE_PAGE_LIMIT = 1_000;

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
      problems,
    };
  });

export const persistEvent = (
  storage: Plugin.Context["storage"],
  kind: "occurrence" | "state",
  record: OccurrenceRecord | StateEventRecord,
): Effect.Effect<void> =>
  storage.set(`${kind === "occurrence" ? OCCURRENCE_PREFIX : STATE_PREFIX}${record.id}`, record);

export const pruneExpiredResolvedGroups = (
  storage: Plugin.Context["storage"],
  loaded: LoadedStore,
  now: number,
  excludeGroupId?: string,
): Effect.Effect<number> =>
  Effect.gen(function* () {
    if (loaded.scanTruncated) return 0;

    const expired = [...loaded.groups.values()]
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
      .slice(0, MAX_PRUNE_GROUPS_PER_CALL);

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
        target: escapeUntrusted(group.target),
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
