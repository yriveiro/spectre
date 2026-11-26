import { type Plugin, Tool } from "@opencode/plugin/effect";
import { Cause, Effect, Schema } from "effect";
import {
  compareGroupOrder,
  type FoldedGroup,
  GroupStatusSchema,
  type OccurrenceRecord,
  type StateEventRecord,
  TargetKindSchema,
} from "./fold";
import {
  canonicalizeTarget,
  computeGroupId,
  isValidGroupId,
  rankByBm25,
  targetBody,
} from "./normalize";
import {
  escapeOptional,
  escapeUntrusted,
  FIELD_LIMITS,
  fenceUntrusted,
  redactOptional,
  redactText,
  sanitizeRepoName,
} from "./redact";
import {
  type LoadedStore,
  loadStore,
  MAX_OCCURRENCES_PER_CYCLE,
  type PapercutRollup,
  PapercutRollupSchema,
  type PapercutsRollupOptions,
  type PapercutsStoreOptions,
  persistEvent,
  pruneExpiredResolvedGroups,
  summarizeOpenPapercuts,
  writeLock,
} from "./store";

export {
  type PapercutRollup,
  PapercutRollupSchema,
  type PapercutsRollupOptions,
  type PapercutsStoreOptions,
  summarizeOpenPapercuts,
  TargetKindSchema,
};

const DAY_MS = 24 * 60 * 60 * 1_000;
const QueryStatusSchema = Schema.Literals(["open", "resolved", "all"]);
const ProjectScopeSchema = Schema.Literals(["all", "current"]);

export const LogInput = Schema.Struct({
  action: Schema.Literals(["log"]).annotate({
    description:
      "File a structured Spectre friction report mid-session. Deduplicates deterministically and returns any known workaround.",
  }),
  targetKind: TargetKindSchema.annotate({
    description: "Kind of Spectre surface that misbehaved: tool, skill, flag, doc, agent, or hook.",
  }),
  target: Schema.String.annotate({
    description:
      "Exact Spectre surface name (for example `tools.spectre.worktrees`, `playbook-bug-fix`, `--edit-check`, `tools/FOR_AGENTS.md`).",
  }),
  tried: Schema.String.annotate({
    description: "Concrete command, tool call, flag, or skill step attempted.",
  }),
  expected: Schema.String.annotate({
    description: "Behavior promised by the skill, schema, doc, or contract.",
  }),
  actual: Schema.String.annotate({
    description: "Observed failure, wrong output, or contradiction.",
  }),
  suggestedFix: Schema.optional(Schema.String).annotate({
    description: "Optional concrete change in Spectre that eliminates this friction.",
  }),
  workaround: Schema.optional(Schema.String).annotate({
    description: "Optional verified workaround that unblocked this session.",
  }),
  context: Schema.optional(Schema.String).annotate({
    description:
      "Optional repro details. Project, repo name, session, agent, and OpenCode version are captured automatically.",
  }),
  groupId: Schema.optional(Schema.String).annotate({
    description:
      "Optional existing `pc_...` group ID from query to attach a +1 occurrence directly. Must share the same canonical target.",
  }),
});

export const ResolveInput = Schema.Struct({
  action: Schema.Literals(["resolve"]).annotate({
    description:
      "Mark a grouped papercut resolved after fixing Spectre, or reopen an existing group with status=open.",
  }),
  groupId: Schema.String.annotate({
    description: "Group ID (`pc_...`) returned by query or log.",
  }),
  resolution: Schema.String.annotate({
    description:
      "Required explanation: commit SHA, PR number, fixed file/symbol, or reason for status change.",
  }),
  status: Schema.optional(GroupStatusSchema).annotate({
    description: "Target status (`resolved` or `open`). Defaults to `resolved`.",
  }),
  workaround: Schema.optional(Schema.String).annotate({
    description: "Optional fallback workaround for installs that have not updated yet.",
  }),
  fixedInVersion: Schema.optional(Schema.String).annotate({
    description: "Optional commit SHA, plugin version, or OpenCode version containing the fix.",
  }),
});

export const QueryInput = Schema.Struct({
  action: Schema.optional(Schema.Literals(["query"])).annotate({
    description:
      "Search known Spectre papercuts and workarounds across repositories, or inspect one groupId in detail. Default action.",
  }),
  query: Schema.optional(Schema.String).annotate({
    description: "Error phrase, symptom, flag, or surface words to rank by BM25.",
  }),
  target: Schema.optional(Schema.String).annotate({
    description: "Filter to one Spectre surface (exact or prefix match after canonicalization).",
  }),
  targetKind: Schema.optional(TargetKindSchema).annotate({
    description: "Filter by surface kind: tool, skill, flag, doc, agent, or hook.",
  }),
  groupId: Schema.optional(Schema.String).annotate({
    description: "Fetch one exact group with its occurrence samples.",
  }),
  status: Schema.optional(QueryStatusSchema).annotate({
    description:
      "Filter by lifecycle status (`open`, `resolved`, `all`). Default `open` (ignored when `groupId` is set).",
  }),
  project: Schema.optional(ProjectScopeSchema).annotate({
    description: "Scope to `all` repositories (default) or `current` project only.",
  }),
  sinceDays: Schema.optional(Schema.Int).annotate({
    description: "Optional lookback window in days (1..365) on `lastSeenAt`.",
  }),
  limit: Schema.optional(Schema.Int).annotate({
    description: "Maximum grouped papercuts to return (1..50). Default 10.",
  }),
  includeOccurrences: Schema.optional(Schema.Boolean).annotate({
    description:
      "Include up to 5 recent occurrence samples per group. Automatically true when `groupId` is set.",
  }),
});

export const PapercutsInput = Schema.Union([LogInput, ResolveInput, QueryInput]);

const OccurrenceSampleSchema = Schema.Struct({
  id: Schema.String,
  repo: Schema.String,
  projectId: Schema.String,
  sessionID: Schema.optional(Schema.String),
  agent: Schema.optional(Schema.String),
  opencodeVersion: Schema.String,
  tried: Schema.String,
  expected: Schema.String,
  actual: Schema.String,
  suggestedFix: Schema.optional(Schema.String),
  workaround: Schema.optional(Schema.String),
  context: Schema.optional(Schema.String),
  at: Schema.Number,
});

const PapercutGroupSchema = Schema.Struct({
  groupId: Schema.String,
  status: GroupStatusSchema,
  reopened: Schema.Boolean,
  targetKind: TargetKindSchema,
  target: Schema.String,
  canonicalTarget: Schema.String,
  occurrences: Schema.Int,
  sessions: Schema.Int,
  projects: Schema.Int,
  repos: Schema.Array(Schema.String),
  firstSeenAt: Schema.Number,
  lastSeenAt: Schema.Number,
  score: Schema.optional(Schema.Number),
  latestTried: Schema.String,
  latestExpected: Schema.String,
  latestActual: Schema.String,
  suggestedFix: Schema.optional(Schema.String),
  workaround: Schema.optional(Schema.String),
  resolution: Schema.optional(Schema.String),
  previousResolution: Schema.optional(Schema.String),
  fixedInVersion: Schema.optional(Schema.String),
  samples: Schema.optional(Schema.Array(OccurrenceSampleSchema)),
});

export const QueriedOutput = Schema.Struct({
  status: Schema.Literals(["queried"]),
  totalMatched: Schema.Int,
  openGroups: Schema.Int,
  resolvedGroups: Schema.Int,
  scanTruncated: Schema.Boolean,
  items: Schema.Array(PapercutGroupSchema),
  problems: Schema.Array(Schema.String),
});

export const LoggedOutput = Schema.Struct({
  status: Schema.Literals(["logged"]),
  id: Schema.String,
  groupId: Schema.String,
  targetKind: TargetKindSchema,
  canonicalTarget: Schema.String,
  wrote: Schema.Boolean,
  deduplicated: Schema.Boolean,
  alreadyLoggedInSession: Schema.Boolean,
  reopened: Schema.Boolean,
  saturated: Schema.Boolean,
  scanTruncated: Schema.Boolean,
  occurrences: Schema.Int,
  projects: Schema.Int,
  repos: Schema.Array(Schema.String),
  knownWorkaround: Schema.optional(Schema.String),
  previousResolution: Schema.optional(Schema.String),
});

export const ResolvedOutput = Schema.Struct({
  status: Schema.Literals(["resolved"]),
  groupId: Schema.String,
  stateStatus: GroupStatusSchema,
  wrote: Schema.Boolean,
  resolution: Schema.String,
  prunedKeys: Schema.Int,
  scanTruncated: Schema.Boolean,
});

export const RejectedOutput = Schema.Struct({
  status: Schema.Literals(["rejected"]),
  action: Schema.Literals(["query", "log", "resolve"]),
  reason: Schema.String,
});

export const PapercutsOutput = Schema.Union([
  QueriedOutput,
  LoggedOutput,
  ResolvedOutput,
  RejectedOutput,
]);

type ToolOutputResult = {
  readonly output: typeof PapercutsOutput.Type;
  readonly content: string;
};

interface CallerMeta {
  readonly projectId: string;
  readonly repo: string;
  readonly sessionID?: string;
  readonly agent?: string;
  readonly opencodeVersion: string;
}

interface ParsedLog {
  readonly targetKind: typeof TargetKindSchema.Type;
  readonly target: string;
  readonly canonicalTarget: string;
  readonly tried: string;
  readonly expected: string;
  readonly actual: string;
  readonly suggestedFix?: string;
  readonly workaround?: string;
  readonly note?: string;
  readonly explicitGroupId?: string;
}

const boundedInt = (
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number => {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  const whole = Math.trunc(value);
  if (whole < min) return min;
  if (whole > max) return max;
  return whole;
};

const reject = (action: "query" | "log" | "resolve", reason: string): ToolOutputResult => ({
  output: { status: "rejected", action, reason },
  content: `Rejected papercuts ${action}: ${reason}`,
});

const toStorageError = (cause: Cause.Cause<unknown>): Tool.Error =>
  new Tool.Error({
    message: "Failed to access papercut storage.",
    error: Cause.squash(cause),
  });

const captureCallerMeta = (
  ctx: Plugin.Context,
  context: Tool.Context | undefined,
): CallerMeta => ({
  projectId: ctx.location.project.id,
  repo: sanitizeRepoName(ctx.location.project.canonical),
  ...(context?.sessionID === undefined ? {} : { sessionID: context.sessionID }),
  ...(context?.agent === undefined ? {} : { agent: context.agent }),
  opencodeVersion:
    redactText(ctx.app?.version ?? "unknown", FIELD_LIMITS.fixedInVersion) || "unknown",
});

const formatSample = (
  occ: OccurrenceRecord,
  currentProjectId: string,
): typeof OccurrenceSampleSchema.Type => ({
  id: occ.id,
  repo: escapeUntrusted(occ.repo),
  projectId: occ.projectId,
  ...(occ.sessionID !== undefined && occ.projectId === currentProjectId
    ? { sessionID: occ.sessionID }
    : {}),
  ...(occ.agent === undefined ? {} : { agent: escapeUntrusted(occ.agent) }),
  opencodeVersion: escapeUntrusted(occ.opencodeVersion),
  tried: escapeUntrusted(occ.tried),
  expected: escapeUntrusted(occ.expected),
  actual: escapeUntrusted(occ.actual),
  ...(occ.suggestedFix === undefined ? {} : { suggestedFix: escapeUntrusted(occ.suggestedFix) }),
  ...(occ.workaround === undefined ? {} : { workaround: escapeUntrusted(occ.workaround) }),
  ...(occ.context === undefined ? {} : { context: escapeUntrusted(occ.context) }),
  at: occ.at,
});

const formatGroup = (
  group: FoldedGroup,
  currentProjectId: string,
  includeOccurrences: boolean,
  score?: number,
): typeof PapercutGroupSchema.Type => ({
  groupId: group.groupId,
  status: group.status,
  reopened: group.reopened,
  targetKind: group.targetKind,
  target: escapeUntrusted(group.target),
  canonicalTarget: escapeUntrusted(group.canonicalTarget),
  occurrences: group.occurrences,
  sessions: group.sessions,
  projects: group.projects,
  repos: group.repos.map(escapeUntrusted),
  firstSeenAt: group.firstSeenAt,
  lastSeenAt: group.lastSeenAt,
  ...(score === undefined ? {} : { score }),
  latestTried: escapeUntrusted(group.latestTried),
  latestExpected: escapeUntrusted(group.latestExpected),
  latestActual: escapeUntrusted(group.latestActual),
  ...(group.suggestedFix === undefined ? {} : { suggestedFix: escapeUntrusted(group.suggestedFix) }),
  ...(group.workaround === undefined ? {} : { workaround: escapeUntrusted(group.workaround) }),
  ...(group.resolution === undefined ? {} : { resolution: escapeUntrusted(group.resolution) }),
  ...(group.previousResolution === undefined
    ? {}
    : { previousResolution: escapeUntrusted(group.previousResolution) }),
  ...(group.fixedInVersion === undefined
    ? {}
    : { fixedInVersion: escapeUntrusted(group.fixedInVersion) }),
  ...(includeOccurrences
    ? {
        samples: group.occurrenceRecords
          .slice(-5)
          .toReversed()
          .map((occ) => formatSample(occ, currentProjectId)),
      }
    : {}),
});

const matchesTargetFilter = (
  group: FoldedGroup,
  rawTarget: string,
  kindFilter: typeof TargetKindSchema.Type | undefined,
): boolean => {
  if (kindFilter !== undefined && group.targetKind !== kindFilter) return false;
  const canonicalNeedle = canonicalizeTarget(kindFilter ?? group.targetKind, rawTarget);
  return (
    group.canonicalTarget === canonicalNeedle || group.canonicalTarget.startsWith(canonicalNeedle)
  );
};

const selectQueryCandidates = (
  loaded: LoadedStore,
  input: typeof QueryInput.Type,
  currentProjectId: string,
  now: number,
): Array<FoldedGroup> => {
  if (input.groupId !== undefined) {
    const exact = loaded.groups.get(input.groupId.trim());
    return exact === undefined ? [] : [exact];
  }
  const targetNeedle = redactOptional(input.target, FIELD_LIMITS.target);
  const cutoffAt =
    input.sinceDays === undefined
      ? undefined
      : now - boundedInt(input.sinceDays, 30, 1, 365) * DAY_MS;
  const statusFilter = input.status ?? "open";
  const projectFilter = input.project ?? "all";

  return [...loaded.groups.values()].filter((group) => {
    if (statusFilter !== "all" && group.status !== statusFilter) return false;
    if (input.targetKind !== undefined && group.targetKind !== input.targetKind) return false;
    if (targetNeedle !== undefined && !matchesTargetFilter(group, targetNeedle, input.targetKind)) {
      return false;
    }
    if (projectFilter === "current" && !group.projectIds.has(currentProjectId)) return false;
    if (cutoffAt !== undefined && group.lastSeenAt < cutoffAt) return false;
    return true;
  });
};

const formatQueryItems = (
  candidates: ReadonlyArray<FoldedGroup>,
  input: typeof QueryInput.Type,
  currentProjectId: string,
): { readonly totalMatched: number; readonly items: Array<typeof PapercutGroupSchema.Type> } => {
  const limit = boundedInt(input.limit, 10, 1, 50);
  const includeOccurrences = Boolean(input.includeOccurrences || input.groupId !== undefined);
  const queryNeedle = redactOptional(input.query, FIELD_LIMITS.actual);

  if (queryNeedle === undefined || input.groupId !== undefined) {
    const sorted = candidates.toSorted(compareGroupOrder);
    return {
      totalMatched: sorted.length,
      items: sorted
        .slice(0, limit)
        .map((group) => formatGroup(group, currentProjectId, includeOccurrences)),
    };
  }

  const docs = candidates.map((group) => ({
    groupId: group.groupId,
    target: group.target,
    canonicalTarget: group.canonicalTarget,
    body: [
      group.latestActual,
      group.latestTried,
      group.latestExpected,
      group.workaround ?? "",
      group.suggestedFix ?? "",
    ].join(" "),
    group,
  }));
  const scored = rankByBm25(docs, queryNeedle).toSorted(
    (left, right) => right.score - left.score || compareGroupOrder(left.item.group, right.item.group),
  );
  return {
    totalMatched: scored.length,
    items: scored
      .slice(0, limit)
      .map((hit) => formatGroup(hit.item.group, currentProjectId, includeOccurrences, hit.score)),
  };
};

const runQuery = (
  ctx: Plugin.Context,
  input: typeof QueryInput.Type,
  now: number,
  options: PapercutsStoreOptions,
) =>
  Effect.gen(function* () {
    if (input.groupId !== undefined && !isValidGroupId(input.groupId.trim())) {
      return reject("query", `Invalid groupId format: ${input.groupId}`);
    }

    const loaded = yield* loadStore(ctx.storage, options);
    const allGroups = [...loaded.groups.values()];
    const openGroups = allGroups.filter((group) => group.status === "open").length;
    const resolvedGroups = allGroups.length - openGroups;

    const candidates = selectQueryCandidates(loaded, input, ctx.location.project.id, now);
    const { totalMatched, items } = formatQueryItems(candidates, input, ctx.location.project.id);

    const output: typeof QueriedOutput.Type = {
      status: "queried",
      totalMatched,
      openGroups,
      resolvedGroups,
      scanTruncated: loaded.scanTruncated,
      items,
      problems: [...loaded.problems],
    };

    const header = `Found ${totalMatched} papercut group(s), showing ${items.length} (${openGroups} open, ${resolvedGroups} resolved${loaded.scanTruncated ? ", scan truncated" : ""}).`;
    if (items.length === 0) return { output, content: header };

    const lines = items.map(
      (item) =>
        `- ${item.groupId} [${item.status}${item.reopened ? ", reopened" : ""}] ${item.target} (${item.occurrences} hits, ${item.projects} project(s)): ${item.latestActual}${item.workaround === undefined ? "" : ` | workaround: ${item.workaround}`}`,
    );
    return { output, content: `${header}\n${fenceUntrusted(lines.join("\n"))}` };
  }).pipe(Effect.catchCause((cause) => Effect.fail(toStorageError(cause))));

const parseLogInput = (
  input: typeof LogInput.Type,
): { readonly ok: true; readonly parsed: ParsedLog } | { readonly ok: false; readonly reason: string } => {
  const target = redactText(input.target, FIELD_LIMITS.target);
  const tried = redactText(input.tried, FIELD_LIMITS.tried);
  const expected = redactText(input.expected, FIELD_LIMITS.expected);
  const actual = redactText(input.actual, FIELD_LIMITS.actual);
  if (target.length === 0) return { ok: false, reason: "target must be non-empty." };
  if (tried.length === 0) return { ok: false, reason: "tried must be non-empty." };
  if (expected.length === 0) return { ok: false, reason: "expected must be non-empty." };
  if (actual.length === 0) return { ok: false, reason: "actual must be non-empty." };

  const canonicalTarget = canonicalizeTarget(input.targetKind, target);
  if (targetBody(canonicalTarget).length === 0) {
    return { ok: false, reason: "target must contain a valid surface name." };
  }

  const explicitGroupId = input.groupId?.trim();
  if (explicitGroupId !== undefined && !isValidGroupId(explicitGroupId)) {
    return { ok: false, reason: `Invalid groupId format: ${explicitGroupId}` };
  }

  const suggestedFix = redactOptional(input.suggestedFix, FIELD_LIMITS.suggestedFix);
  const workaround = redactOptional(input.workaround, FIELD_LIMITS.workaround);
  const note = redactOptional(input.context, FIELD_LIMITS.context);

  return {
    ok: true,
    parsed: {
      targetKind: input.targetKind,
      target,
      canonicalTarget,
      tried,
      expected,
      actual,
      ...(suggestedFix === undefined ? {} : { suggestedFix }),
      ...(workaround === undefined ? {} : { workaround }),
      ...(note === undefined ? {} : { note }),
      ...(explicitGroupId === undefined ? {} : { explicitGroupId }),
    },
  };
};

const resolveLogGroup = (
  loaded: LoadedStore,
  parsed: ParsedLog,
):
  | { readonly ok: true; readonly groupId: string; readonly existing: FoldedGroup | undefined }
  | { readonly ok: false; readonly reason: string } => {
  if (parsed.explicitGroupId === undefined) {
    const groupId = computeGroupId(parsed.canonicalTarget, parsed.actual, parsed.tried);
    return { ok: true, groupId, existing: loaded.groups.get(groupId) };
  }

  const existing = loaded.groups.get(parsed.explicitGroupId);
  if (existing === undefined) {
    return {
      ok: false,
      reason: loaded.scanTruncated
        ? `Unknown or truncated groupId: ${parsed.explicitGroupId}`
        : `Unknown groupId: ${parsed.explicitGroupId}`,
    };
  }
  if (existing.canonicalTarget !== parsed.canonicalTarget) {
    return {
      ok: false,
      reason: `Explicit groupId ${parsed.explicitGroupId} targets ${existing.canonicalTarget}, not ${parsed.canonicalTarget}.`,
    };
  }
  return { ok: true, groupId: parsed.explicitGroupId, existing };
};

const buildExistingLogResponse = (
  existing: FoldedGroup,
  flags: {
    readonly id: string;
    readonly wrote: boolean;
    readonly alreadyLoggedInSession: boolean;
    readonly saturated: boolean;
    readonly scanTruncated: boolean;
    readonly workaround?: string;
  },
  content: string,
): ToolOutputResult => {
  const knownWorkaround = escapeOptional(flags.workaround ?? existing.workaround);
  const output: typeof LoggedOutput.Type = {
    status: "logged",
    id: flags.id,
    groupId: existing.groupId,
    targetKind: existing.targetKind,
    canonicalTarget: escapeUntrusted(existing.canonicalTarget),
    wrote: flags.wrote,
    deduplicated: true,
    alreadyLoggedInSession: flags.alreadyLoggedInSession,
    reopened: existing.reopened,
    saturated: flags.saturated,
    scanTruncated: flags.scanTruncated,
    occurrences: existing.occurrences,
    projects: existing.projects,
    repos: existing.repos.map(escapeUntrusted),
    ...(knownWorkaround === undefined ? {} : { knownWorkaround }),
    ...(existing.previousResolution === undefined
      ? {}
      : { previousResolution: escapeUntrusted(existing.previousResolution) }),
  };
  return { output, content };
};

interface WorkaroundWriteArgs {
  readonly storage: Plugin.Context["storage"];
  readonly existing: FoldedGroup;
  readonly workaround: string;
  readonly meta: CallerMeta;
  readonly now: number;
  readonly loaded: LoadedStore;
  readonly alreadyLoggedInSession: boolean;
  readonly saturated: boolean;
}

const annotateExistingWorkaround = (args: WorkaroundWriteArgs): Effect.Effect<ToolOutputResult> =>
  Effect.gen(function* () {
    if (args.loaded.stateTruncated) {
      return reject(
        "log",
        "Papercut state store reached scan capacity; cannot append workaround annotation safely.",
      );
    }
    const stateId = Bun.randomUUIDv7();
    const annotation: StateEventRecord = {
      v: 1,
      id: stateId,
      groupId: args.existing.groupId,
      status: "open",
      workaround: args.workaround,
      projectId: args.meta.projectId,
      repo: args.meta.repo,
      ...(args.meta.sessionID === undefined ? {} : { sessionID: args.meta.sessionID }),
      ...(args.meta.agent === undefined ? {} : { agent: args.meta.agent }),
      at: args.now,
    };
    yield* persistEvent(args.storage, "state", annotation);
    const escaped = escapeUntrusted(args.workaround);
    return buildExistingLogResponse(
      args.existing,
      {
        id: stateId,
        wrote: true,
        alreadyLoggedInSession: args.alreadyLoggedInSession,
        saturated: args.saturated,
        scanTruncated: args.loaded.scanTruncated,
        workaround: args.workaround,
      },
      `Updated workaround on ${args.existing.groupId}.\n${fenceUntrusted(`workaround: ${escaped}`)}`,
    );
  });

interface AppendOccurrenceArgs {
  readonly storage: Plugin.Context["storage"];
  readonly parsed: ParsedLog;
  readonly groupId: string;
  readonly existing: FoldedGroup | undefined;
  readonly meta: CallerMeta;
  readonly now: number;
  readonly scanTruncated: boolean;
}

const buildOccurrenceRecord = (id: string, args: AppendOccurrenceArgs): OccurrenceRecord => ({
  v: 1,
  id,
  groupId: args.groupId,
  targetKind: args.parsed.targetKind,
  target: args.parsed.target,
  canonicalTarget: args.parsed.canonicalTarget,
  tried: args.parsed.tried,
  expected: args.parsed.expected,
  actual: args.parsed.actual,
  ...(args.parsed.suggestedFix === undefined ? {} : { suggestedFix: args.parsed.suggestedFix }),
  ...(args.parsed.workaround === undefined ? {} : { workaround: args.parsed.workaround }),
  ...(args.parsed.note === undefined ? {} : { context: args.parsed.note }),
  projectId: args.meta.projectId,
  repo: args.meta.repo,
  ...(args.meta.sessionID === undefined ? {} : { sessionID: args.meta.sessionID }),
  ...(args.meta.agent === undefined ? {} : { agent: args.meta.agent }),
  opencodeVersion: args.meta.opencodeVersion,
  at: args.now,
});

const buildLoggedResult = (id: string, args: AppendOccurrenceArgs): ToolOutputResult => {
  const reopened = args.existing !== undefined && args.existing.status === "resolved";
  const previousResolution = escapeOptional(
    reopened ? args.existing?.resolution : args.existing?.previousResolution,
  );
  const knownWorkaround = escapeOptional(args.parsed.workaround ?? args.existing?.workaround);
  const updatedProjects = new Set(args.existing?.projectIds ?? []);
  updatedProjects.add(args.meta.projectId);
  const updatedRepos = [...new Set([...(args.existing?.repos ?? []), args.meta.repo])].toSorted(
    (left, right) => (left < right ? -1 : left > right ? 1 : 0),
  );
  const occurrences = (args.existing?.occurrences ?? 0) + 1;

  const output: typeof LoggedOutput.Type = {
    status: "logged",
    id,
    groupId: args.groupId,
    targetKind: args.parsed.targetKind,
    canonicalTarget: escapeUntrusted(args.parsed.canonicalTarget),
    wrote: true,
    deduplicated: args.existing !== undefined,
    alreadyLoggedInSession: false,
    reopened,
    saturated: false,
    scanTruncated: args.scanTruncated,
    occurrences,
    projects: updatedProjects.size,
    repos: updatedRepos.map(escapeUntrusted),
    ...(knownWorkaround === undefined ? {} : { knownWorkaround }),
    ...(previousResolution === undefined ? {} : { previousResolution }),
  };

  const summary = reopened
    ? `Reopened papercut ${args.groupId} on regression (${occurrences} hit(s) across ${updatedProjects.size} project(s)).`
    : args.existing !== undefined
      ? `Logged occurrence on existing papercut ${args.groupId} (${occurrences} hit(s) across ${updatedProjects.size} project(s)).`
      : `Logged new papercut ${args.groupId} for ${escapeUntrusted(args.parsed.canonicalTarget)}.`;

  return {
    output,
    content:
      knownWorkaround === undefined
        ? summary
        : `${summary}\n${fenceUntrusted(`known workaround: ${knownWorkaround}`)}`,
  };
};

const appendNewOccurrence = (args: AppendOccurrenceArgs): Effect.Effect<ToolOutputResult> =>
  Effect.gen(function* () {
    const id = Bun.randomUUIDv7();
    yield* persistEvent(args.storage, "occurrence", buildOccurrenceRecord(id, args));
    return buildLoggedResult(id, args);
  });

const handleOpenGroupGuard = (args: {
  readonly storage: Plugin.Context["storage"];
  readonly existing: FoldedGroup;
  readonly workaround: string | undefined;
  readonly meta: CallerMeta;
  readonly now: number;
  readonly loaded: LoadedStore;
}): Effect.Effect<ToolOutputResult | undefined> => {
  const newWorkaround =
    args.workaround !== undefined && args.workaround !== args.existing.workaround
      ? args.workaround
      : undefined;
  const repeatInSession =
    args.meta.sessionID !== undefined &&
    args.existing.sessionIdsAfterLastResolve.has(args.meta.sessionID);
  const saturated = args.existing.occurrencesAfterLastResolve >= MAX_OCCURRENCES_PER_CYCLE;

  if (!repeatInSession && !saturated) return Effect.succeed(undefined);

  if (newWorkaround !== undefined) {
    return annotateExistingWorkaround({
      storage: args.storage,
      existing: args.existing,
      workaround: newWorkaround,
      meta: args.meta,
      now: args.now,
      loaded: args.loaded,
      alreadyLoggedInSession: repeatInSession,
      saturated: !repeatInSession && saturated,
    });
  }

  const known = escapeOptional(args.existing.workaround);
  const content = repeatInSession
    ? known === undefined
      ? `Papercut ${args.existing.groupId} was already logged in this session.`
      : `Papercut ${args.existing.groupId} was already logged in this session.\n${fenceUntrusted(`known workaround: ${known}`)}`
    : `Papercut ${args.existing.groupId} reached per-cycle occurrence cap (${MAX_OCCURRENCES_PER_CYCLE}).`;

  return Effect.succeed(
    buildExistingLogResponse(
      args.existing,
      {
        id: args.existing.occurrenceRecords.at(-1)?.id ?? args.existing.groupId,
        wrote: false,
        alreadyLoggedInSession: repeatInSession,
        saturated: !repeatInSession && saturated,
        scanTruncated: args.loaded.scanTruncated,
      },
      content,
    ),
  );
};

const runLog = (
  ctx: Plugin.Context,
  input: typeof LogInput.Type,
  context: Tool.Context | undefined,
  now: number,
  options: PapercutsStoreOptions,
) =>
  writeLock.withPermits(1)(
    Effect.gen(function* () {
      const checked = parseLogInput(input);
      if (!checked.ok) return reject("log", checked.reason);
      const parsed = checked.parsed;

      const loaded = yield* loadStore(ctx.storage, options);
      const target = resolveLogGroup(loaded, parsed);
      if (!target.ok) return reject("log", target.reason);
      if (loaded.occurrenceTruncated) {
        return reject(
          "log",
          "Papercut occurrence store reached scan capacity; resolve older groups before logging new reports.",
        );
      }

      const meta = captureCallerMeta(ctx, context);
      const { groupId, existing } = target;
      if (existing !== undefined && existing.status === "open") {
        const guarded = yield* handleOpenGroupGuard({
          storage: ctx.storage,
          existing,
          workaround: parsed.workaround,
          meta,
          now,
          loaded,
        });
        if (guarded !== undefined) return guarded;
      }

      return yield* appendNewOccurrence({
        storage: ctx.storage,
        parsed,
        groupId,
        existing,
        meta,
        now,
        scanTruncated: loaded.scanTruncated,
      });
    }),
  ).pipe(Effect.catchCause((cause) => Effect.fail(toStorageError(cause))));

const isRedundantState = (
  existing: FoldedGroup,
  targetStatus: "open" | "resolved",
  resolution: string,
  fixedInVersion: string | undefined,
  workaround: string | undefined,
): boolean =>
  existing.status === targetStatus &&
  existing.resolution === resolution &&
  (fixedInVersion === undefined || existing.fixedInVersion === fixedInVersion) &&
  (workaround === undefined || existing.workaround === workaround);

interface ParsedResolve {
  readonly groupId: string;
  readonly resolution: string;
  readonly workaround?: string;
  readonly fixedInVersion?: string;
  readonly targetStatus: "open" | "resolved";
}

const parseResolveInput = (
  input: typeof ResolveInput.Type,
):
  | { readonly ok: true; readonly parsed: ParsedResolve }
  | { readonly ok: false; readonly reason: string } => {
  const groupId = input.groupId.trim();
  if (!isValidGroupId(groupId)) return { ok: false, reason: `Invalid groupId format: ${groupId}` };
  const resolution = redactText(input.resolution, FIELD_LIMITS.resolution);
  if (resolution.length === 0) return { ok: false, reason: "resolution must be non-empty." };
  const workaround = redactOptional(input.workaround, FIELD_LIMITS.workaround);
  const fixedInVersion = redactOptional(input.fixedInVersion, FIELD_LIMITS.fixedInVersion);
  return {
    ok: true,
    parsed: {
      groupId,
      resolution,
      ...(workaround === undefined ? {} : { workaround }),
      ...(fixedInVersion === undefined ? {} : { fixedInVersion }),
      targetStatus: input.status ?? "resolved",
    },
  };
};

const writeResolutionIfNeeded = (
  ctx: Plugin.Context,
  existing: FoldedGroup,
  parsed: ParsedResolve,
  context: Tool.Context | undefined,
  now: number,
): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    if (
      isRedundantState(
        existing,
        parsed.targetStatus,
        parsed.resolution,
        parsed.fixedInVersion,
        parsed.workaround,
      )
    ) {
      return false;
    }
    const meta = captureCallerMeta(ctx, context);
    const record: StateEventRecord = {
      v: 1,
      id: Bun.randomUUIDv7(),
      groupId: parsed.groupId,
      status: parsed.targetStatus,
      resolution: parsed.resolution,
      ...(parsed.workaround === undefined ? {} : { workaround: parsed.workaround }),
      ...(parsed.fixedInVersion === undefined ? {} : { fixedInVersion: parsed.fixedInVersion }),
      projectId: meta.projectId,
      repo: meta.repo,
      ...(meta.sessionID === undefined ? {} : { sessionID: meta.sessionID }),
      ...(meta.agent === undefined ? {} : { agent: meta.agent }),
      at: now,
    };
    yield* persistEvent(ctx.storage, "state", record);
    return true;
  });

const runResolve = (
  ctx: Plugin.Context,
  input: typeof ResolveInput.Type,
  context: Tool.Context | undefined,
  now: number,
  options: PapercutsStoreOptions,
) =>
  writeLock.withPermits(1)(
    Effect.gen(function* () {
      const checked = parseResolveInput(input);
      if (!checked.ok) return reject("resolve", checked.reason);
      const parsed = checked.parsed;

      const loaded = yield* loadStore(ctx.storage, options);
      const existing = loaded.groups.get(parsed.groupId);
      if (existing === undefined) {
        return reject(
          "resolve",
          loaded.scanTruncated
            ? `Unknown or truncated groupId: ${parsed.groupId}`
            : `Unknown groupId: ${parsed.groupId}`,
        );
      }
      if (loaded.stateTruncated) {
        return reject(
          "resolve",
          "Papercut state store reached scan capacity; cannot append state event safely.",
        );
      }

      const wrote = yield* writeResolutionIfNeeded(ctx, existing, parsed, context, now);
      const prunedKeys = yield* pruneExpiredResolvedGroups(ctx.storage, loaded, now, parsed.groupId);
      const output: typeof ResolvedOutput.Type = {
        status: "resolved",
        groupId: parsed.groupId,
        stateStatus: parsed.targetStatus,
        wrote,
        resolution: escapeUntrusted(parsed.resolution),
        prunedKeys,
        scanTruncated: loaded.scanTruncated,
      };
      return {
        output,
        content: `Papercut ${parsed.groupId} set to ${parsed.targetStatus} (wrote=${wrote}, prunedKeys=${prunedKeys}${loaded.scanTruncated ? ", scan truncated" : ""}).`,
      };
    }),
  ).pipe(Effect.catchCause((cause) => Effect.fail(toStorageError(cause))));

const dispatchAction = (
  ctx: Plugin.Context,
  input: typeof PapercutsInput.Type,
  context: Tool.Context | undefined,
  clock: () => number,
  options: PapercutsStoreOptions,
) => {
  const now = clock();
  switch (input.action) {
    case "log":
      return runLog(ctx, input, context, now, options);
    case "resolve":
      return runResolve(ctx, input, context, now, options);
    default:
      return runQuery(ctx, input, now, options);
  }
};

export const DESCRIPTION = `Log cross-project Spectre friction reports (papercuts), query known workarounds, and resolve grouped defects.
Use action=query before retrying when a Spectre skill, tool, flag, agent, hook, or doc misbehaves to check known workarounds across repositories. Use action=log to file structured tried/expected/actual friction reports with exact deduplication, and action=resolve to close or reopen grouped papercuts after a fix lands.`;

export const papercuts = (
  ctx: Plugin.Context,
  clock: () => number = Date.now,
  options: PapercutsStoreOptions = {},
): Tool.Info<typeof PapercutsInput, typeof PapercutsOutput> => ({
  name: "papercuts",
  description: DESCRIPTION,
  options: {
    namespace: "spectre",
    codemode: true,
    permission: "papercuts",
  },
  input: PapercutsInput,
  output: PapercutsOutput,
  execute: (input, context) => dispatchAction(ctx, input, context, clock, options),
});
