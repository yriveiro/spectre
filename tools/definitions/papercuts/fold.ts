import { Schema } from "effect";
import { TARGET_KINDS, type TargetKind } from "./normalize";

export const TargetKindSchema = Schema.Literals([...TARGET_KINDS]);
export const GroupStatusSchema = Schema.Literals(["open", "resolved"]);
export type GroupStatus = typeof GroupStatusSchema.Type;

export const OccurrenceRecordSchema = Schema.Struct({
  v: Schema.Literals([1]),
  id: Schema.String,
  groupId: Schema.String,
  targetKind: TargetKindSchema,
  target: Schema.String,
  canonicalTarget: Schema.String,
  tried: Schema.String,
  expected: Schema.String,
  actual: Schema.String,
  suggestedFix: Schema.optional(Schema.String),
  workaround: Schema.optional(Schema.String),
  context: Schema.optional(Schema.String),
  projectId: Schema.String,
  repo: Schema.String,
  sessionID: Schema.optional(Schema.String),
  agent: Schema.optional(Schema.String),
  opencodeVersion: Schema.String,
  at: Schema.Number,
});
export type OccurrenceRecord = typeof OccurrenceRecordSchema.Type;

export const StateEventRecordSchema = Schema.Struct({
  v: Schema.Literals([1]),
  id: Schema.String,
  groupId: Schema.String,
  status: GroupStatusSchema,
  resolution: Schema.optional(Schema.String),
  workaround: Schema.optional(Schema.String),
  fixedInVersion: Schema.optional(Schema.String),
  projectId: Schema.String,
  repo: Schema.String,
  sessionID: Schema.optional(Schema.String),
  agent: Schema.optional(Schema.String),
  at: Schema.Number,
});
export type StateEventRecord = typeof StateEventRecordSchema.Type;

export interface FoldedGroup {
  readonly groupId: string;
  readonly status: GroupStatus;
  readonly reopened: boolean;
  readonly targetKind: TargetKind;
  readonly target: string;
  readonly canonicalTarget: string;
  readonly occurrences: number;
  readonly sessions: number;
  readonly projects: number;
  readonly repos: ReadonlyArray<string>;
  readonly projectIds: ReadonlySet<string>;
  readonly firstSeenAt: number;
  readonly lastSeenAt: number;
  readonly resolvedAt?: number;
  readonly latestTried: string;
  readonly latestExpected: string;
  readonly latestActual: string;
  readonly suggestedFix?: string;
  readonly workaround?: string;
  readonly resolution?: string;
  readonly previousResolution?: string;
  readonly fixedInVersion?: string;
  readonly sessionIdsAfterLastResolve: ReadonlySet<string>;
  readonly occurrencesAfterLastResolve: number;
  readonly occurrenceRecords: ReadonlyArray<OccurrenceRecord>;
  readonly occurrenceKeys: ReadonlyArray<string>;
  readonly stateKeys: ReadonlyArray<string>;
}

export interface FoldResult {
  readonly groups: ReadonlyMap<string, FoldedGroup>;
  readonly problems: ReadonlyArray<string>;
}

type TimelineEvent =
  | { readonly kind: "occurrence"; readonly record: OccurrenceRecord }
  | { readonly kind: "state"; readonly record: StateEventRecord };

interface GroupAccumulator {
  status: GroupStatus;
  reopened: boolean;
  targetKind: TargetKind | undefined;
  target: string;
  canonicalTarget: string;
  firstSeenAt: number;
  lastSeenAt: number;
  resolvedAt: number | undefined;
  latestTried: string;
  latestExpected: string;
  latestActual: string;
  suggestedFix: string | undefined;
  workaround: string | undefined;
  resolution: string | undefined;
  previousResolution: string | undefined;
  fixedInVersion: string | undefined;
  occurrencesAfterLastResolve: number;
  readonly projectIds: Set<string>;
  readonly repos: Set<string>;
  readonly sessions: Set<string>;
  readonly sessionIdsAfterLastResolve: Set<string>;
  readonly occurrenceRecords: Array<OccurrenceRecord>;
}

const nonEmpty = (value: string | undefined): string | undefined =>
  value !== undefined && value.length > 0 ? value : undefined;

const makeAccumulator = (): GroupAccumulator => ({
  status: "open",
  reopened: false,
  targetKind: undefined,
  target: "",
  canonicalTarget: "",
  firstSeenAt: Number.POSITIVE_INFINITY,
  lastSeenAt: Number.NEGATIVE_INFINITY,
  resolvedAt: undefined,
  latestTried: "",
  latestExpected: "",
  latestActual: "",
  suggestedFix: undefined,
  workaround: undefined,
  resolution: undefined,
  previousResolution: undefined,
  fixedInVersion: undefined,
  occurrencesAfterLastResolve: 0,
  projectIds: new Set(),
  repos: new Set(),
  sessions: new Set(),
  sessionIdsAfterLastResolve: new Set(),
  occurrenceRecords: [],
});

const applyOccurrence = (acc: GroupAccumulator, rec: OccurrenceRecord): void => {
  acc.occurrenceRecords.push(rec);
  if (acc.targetKind === undefined) {
    acc.targetKind = rec.targetKind;
    acc.target = rec.target;
    acc.canonicalTarget = rec.canonicalTarget;
  }
  if (rec.at < acc.firstSeenAt) acc.firstSeenAt = rec.at;
  if (rec.at >= acc.lastSeenAt) {
    acc.lastSeenAt = rec.at;
    acc.target = rec.target;
    acc.latestTried = rec.tried;
    acc.latestExpected = rec.expected;
    acc.latestActual = rec.actual;
  }
  acc.suggestedFix = nonEmpty(rec.suggestedFix) ?? acc.suggestedFix;
  acc.workaround = nonEmpty(rec.workaround) ?? acc.workaround;
  acc.projectIds.add(rec.projectId);
  acc.repos.add(rec.repo);
  acc.sessions.add(rec.sessionID ?? rec.id);

  if (acc.status === "resolved") {
    acc.status = "open";
    acc.reopened = true;
    acc.previousResolution = acc.resolution;
    acc.resolution = undefined;
    acc.fixedInVersion = undefined;
    acc.resolvedAt = undefined;
    acc.sessionIdsAfterLastResolve.clear();
    acc.occurrencesAfterLastResolve = 0;
  }

  acc.occurrencesAfterLastResolve += 1;
  if (rec.sessionID !== undefined) {
    acc.sessionIdsAfterLastResolve.add(rec.sessionID);
  }
};

const applyStateEvent = (acc: GroupAccumulator, rec: StateEventRecord): void => {
  acc.workaround = nonEmpty(rec.workaround) ?? acc.workaround;
  if (rec.status === "resolved") {
    acc.status = "resolved";
    acc.reopened = false;
    acc.resolvedAt = rec.at;
    acc.resolution = rec.resolution;
    acc.fixedInVersion = rec.fixedInVersion;
    acc.sessionIdsAfterLastResolve.clear();
    acc.occurrencesAfterLastResolve = 0;
    return;
  }

  if (acc.status === "resolved") {
    acc.reopened = true;
    acc.previousResolution = acc.resolution;
    acc.resolvedAt = undefined;
    acc.fixedInVersion = undefined;
  }
  acc.status = "open";
  acc.resolution = nonEmpty(rec.resolution) ?? acc.resolution;
};

export const compareEventOrder = (
  left: { readonly at: number; readonly id: string },
  right: { readonly at: number; readonly id: string },
): number => left.at - right.at || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);

export const compareGroupOrder = (left: FoldedGroup, right: FoldedGroup): number =>
  right.projects - left.projects ||
  (right.reopened ? 1 : 0) - (left.reopened ? 1 : 0) ||
  right.lastSeenAt - left.lastSeenAt ||
  (left.groupId < right.groupId ? -1 : left.groupId > right.groupId ? 1 : 0);

const toFoldedGroup = (
  groupId: string,
  acc: GroupAccumulator,
  occurrenceKeys: ReadonlyArray<string>,
  stateKeys: ReadonlyArray<string>,
): FoldedGroup | undefined => {
  if (acc.occurrenceRecords.length === 0 || acc.targetKind === undefined) return undefined;
  return {
    groupId,
    status: acc.status,
    reopened: acc.reopened,
    targetKind: acc.targetKind,
    target: acc.target,
    canonicalTarget: acc.canonicalTarget,
    occurrences: acc.occurrenceRecords.length,
    sessions: acc.sessions.size,
    projects: acc.projectIds.size,
    repos: [...acc.repos].toSorted((left, right) => (left < right ? -1 : left > right ? 1 : 0)),
    projectIds: acc.projectIds,
    firstSeenAt: acc.firstSeenAt,
    lastSeenAt: acc.lastSeenAt,
    ...(acc.resolvedAt === undefined ? {} : { resolvedAt: acc.resolvedAt }),
    latestTried: acc.latestTried,
    latestExpected: acc.latestExpected,
    latestActual: acc.latestActual,
    ...(acc.suggestedFix === undefined ? {} : { suggestedFix: acc.suggestedFix }),
    ...(acc.workaround === undefined ? {} : { workaround: acc.workaround }),
    ...(acc.resolution === undefined ? {} : { resolution: acc.resolution }),
    ...(acc.previousResolution === undefined ? {} : { previousResolution: acc.previousResolution }),
    ...(acc.fixedInVersion === undefined ? {} : { fixedInVersion: acc.fixedInVersion }),
    sessionIdsAfterLastResolve: acc.sessionIdsAfterLastResolve,
    occurrencesAfterLastResolve: acc.occurrencesAfterLastResolve,
    occurrenceRecords: acc.occurrenceRecords,
    occurrenceKeys,
    stateKeys,
  };
};

const foldSingleGroup = (
  groupId: string,
  timeline: ReadonlyArray<TimelineEvent>,
  occurrenceKeys: ReadonlyArray<string>,
  stateKeys: ReadonlyArray<string>,
): FoldedGroup | undefined => {
  const ordered = timeline.toSorted(
    (left, right) =>
      compareEventOrder(left.record, right.record) ||
      (left.kind === right.kind ? 0 : left.kind === "occurrence" ? -1 : 1),
  );
  const acc = makeAccumulator();
  for (const event of ordered) {
    if (event.kind === "occurrence") applyOccurrence(acc, event.record);
    else applyStateEvent(acc, event.record);
  }
  return toFoldedGroup(groupId, acc, occurrenceKeys, stateKeys);
};

export const foldEvents = (
  occurrences: ReadonlyArray<OccurrenceRecord>,
  states: ReadonlyArray<StateEventRecord>,
  occurrenceKeysById?: ReadonlyMap<string, string>,
  stateKeysById?: ReadonlyMap<string, string>,
): FoldResult => {
  const buckets = new Map<string, Array<TimelineEvent>>();
  const occKeys = new Map<string, Array<string>>();
  const stKeys = new Map<string, Array<string>>();

  for (const record of occurrences) {
    const list = buckets.get(record.groupId) ?? [];
    list.push({ kind: "occurrence", record });
    buckets.set(record.groupId, list);
    const key = occurrenceKeysById?.get(record.id);
    if (key !== undefined) {
      const keys = occKeys.get(record.groupId) ?? [];
      keys.push(key);
      occKeys.set(record.groupId, keys);
    }
  }

  for (const record of states) {
    const list = buckets.get(record.groupId) ?? [];
    list.push({ kind: "state", record });
    buckets.set(record.groupId, list);
    const key = stateKeysById?.get(record.id);
    if (key !== undefined) {
      const keys = stKeys.get(record.groupId) ?? [];
      keys.push(key);
      stKeys.set(record.groupId, keys);
    }
  }

  const groups = new Map<string, FoldedGroup>();
  const problems: Array<string> = [];

  for (const [groupId, timeline] of buckets) {
    const folded = foldSingleGroup(
      groupId,
      timeline,
      occKeys.get(groupId) ?? [],
      stKeys.get(groupId) ?? [],
    );
    if (folded === undefined) {
      problems.push(`Skipped state-only papercut group without occurrences: ${groupId}`);
    } else {
      groups.set(groupId, folded);
    }
  }

  return { groups, problems };
};
