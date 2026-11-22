import type { Plugin } from "@opencode/plugin/effect";
import { Effect, Option, Schema, Semaphore } from "effect";

const PREFIX = "nocturna:";
const MAX_ENTRIES = 1_000;
const RETENTION_MS = 90 * 24 * 60 * 60 * 1_000;

const writeLock = Semaphore.makeUnsafe(1);

export const LedgerEntry = Schema.Struct({
  session: Schema.String,
  updatedAt: Schema.Number,
  analyzedAt: Schema.Number,
});
export type LedgerEntry = typeof LedgerEntry.Type;

const Store = Schema.Struct({ entries: Schema.Array(LedgerEntry) });
const decodeStore = Schema.decodeUnknownOption(Store);

const storageKey = (project: string): string => `${PREFIX}${project}`;

export const openLedger = (
  storage: Plugin.Context["storage"],
  project: string,
  now: number,
): Effect.Effect<Map<string, LedgerEntry>> =>
  Effect.gen(function* () {
    const raw = yield* storage.get(storageKey(project));
    const decoded = Option.getOrUndefined(decodeStore(raw));
    const minAnalyzed = now - RETENTION_MS;
    const map = new Map<string, LedgerEntry>();
    if (decoded === undefined) return map;
    for (const entry of decoded.entries) {
      if (entry.analyzedAt >= minAnalyzed) map.set(entry.session, entry);
    }
    return map;
  });

export interface MarkUpdate {
  readonly session: string;
  readonly updatedAt: number;
}

export interface MarkOutcome {
  readonly marked: number;
  readonly updated: number;
  readonly trackedInStorage: number;
}

const applyMarkUpdates = (
  bySession: Map<string, LedgerEntry>,
  updates: ReadonlyArray<MarkUpdate>,
  now: number,
): { readonly marked: number; readonly updated: number } => {
  let marked = 0;
  let updated = 0;

  for (const item of updates) {
    const prev = bySession.get(item.session);
    if (prev === undefined) {
      marked += 1;
      bySession.set(item.session, {
        session: item.session,
        updatedAt: item.updatedAt,
        analyzedAt: now,
      });
    } else {
      if (item.updatedAt > prev.updatedAt) updated += 1;
      bySession.set(item.session, {
        session: item.session,
        updatedAt: Math.max(prev.updatedAt, item.updatedAt),
        analyzedAt: now,
      });
    }
  }

  return { marked, updated };
};

export const markLedger = (
  storage: Plugin.Context["storage"],
  project: string,
  updates: ReadonlyArray<MarkUpdate>,
  now: number,
): Effect.Effect<MarkOutcome> =>
  writeLock.withPermits(1)(
    Effect.gen(function* () {
      const bySession = yield* openLedger(storage, project, now);
      const counts = applyMarkUpdates(bySession, updates, now);
      const entries = [...bySession.values()]
        .toSorted((left, right) => right.analyzedAt - left.analyzedAt)
        .slice(0, MAX_ENTRIES);

      yield* storage.set(storageKey(project), { entries });
      return {
        marked: counts.marked,
        updated: counts.updated,
        trackedInStorage: entries.length,
      };
    }),
  );
