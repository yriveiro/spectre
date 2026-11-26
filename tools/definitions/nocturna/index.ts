import { Agent, type Plugin, Tool } from "@opencode/plugin/effect";
import { Session } from "@opencode/schema/session";
import { Effect, Option, Result, Schema } from "effect";
import { type PapercutRollup, PapercutRollupSchema, summarizeOpenPapercuts } from "../papercuts";
import {
  digestSession,
  inspectMessages,
  type SessionDigest,
  type SessionDigestResult,
  type ToolStat,
  toMillis,
} from "./digest";
import { type LedgerEntry, markLedger, openLedger } from "./ledger";
import { attachSkillTelemetry } from "./telemetry";
import { pruneSkillTelemetry, readSessionTelemetry } from "./telemetry-store";

export { attachSkillTelemetry };

const DAY_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_DAYS = 7;
const DEFAULT_LIMIT = 25;
const DEFAULT_MAX_CHARS = 300;
const PAGE_SIZE = 100;
const MAX_SCAN_ROWS = 2_000;

const decodeSessionID = Schema.decodeUnknownOption(Session.ID);

export const CollectInput = Schema.Struct({
  action: Schema.optional(Schema.Literals(["collect"])).annotate({
    description:
      "Scan the rolling session window via ctx.session and skip unchanged sessions already recorded in ctx.storage. Default action.",
  }),
  days: Schema.optional(Schema.Finite).annotate({
    description: "Rolling lookback window in days (1..90). Default 7.",
  }),
  limit: Schema.optional(Schema.Int).annotate({
    description: "Maximum unanalyzed sessions to digest in this call (1..100). Default 25.",
  }),
  offset: Schema.optional(Schema.Int).annotate({
    description:
      "Number of ranked pending sessions to skip before slicing limit (>= 0). Default 0.",
  }),
  includeAnalyzed: Schema.optional(Schema.Boolean).annotate({
    description: "Re-scan sessions in the window even when their updatedAt matches ctx.storage.",
  }),
});

export const InspectInput = Schema.Struct({
  action: Schema.Literals(["inspect"]).annotate({
    description:
      "Read compact turn-by-turn message, skill, and tool-call traces for outlier sessions.",
  }),
  sessions: Schema.Array(Schema.String).annotate({
    description: "Session IDs (1..10) returned by collect to inspect in detail.",
  }),
  maxChars: Schema.optional(Schema.Int).annotate({
    description:
      "Maximum characters per text, input, output, or error snippet (80..2000). Default 300.",
  }),
});

export const MarkInput = Schema.Struct({
  action: Schema.Literals(["mark"]).annotate({
    description:
      "Record audited session IDs and their current updatedAt watermark in OpenCode plugin storage so future runs skip them unless resumed.",
  }),
  sessions: Schema.Array(Schema.String).annotate({
    description: "Audited session IDs to watermark in ctx.storage.",
  }),
});

export const NocturnaInput = Schema.Union([CollectInput, InspectInput, MarkInput]);

const ToolStatSchema = Schema.Struct({
  name: Schema.String,
  calls: Schema.Int,
  errors: Schema.Int,
  sampleError: Schema.optional(Schema.String),
});

const TelemetryCoverageSchema = Schema.Literals(["live", "transcript", "hybrid", "none"]);

const SkillTriggersSchema = Schema.Struct({
  "agent-tool": Schema.Int,
  "prompt-attachment": Schema.Int,
  "api-activation": Schema.Int,
});

const TokensSchema = Schema.Struct({
  input: Schema.Number,
  output: Schema.Number,
  reasoning: Schema.Number,
  cacheRead: Schema.Number,
  cacheWrite: Schema.Number,
});

const SkillStatSchema = Schema.Struct({
  skill: Schema.String,
  sessions: Schema.Int,
  invocations: Schema.Int,
  triggers: SkillTriggersSchema,
  loadErrors: Schema.Int,
  attributedCost: Schema.Number,
  attributedTokens: TokensSchema,
  unmeasuredSteps: Schema.Int,
  postLoadErrors: Schema.Int,
});

const SkillCoUseSchema = Schema.Struct({
  left: Schema.String,
  right: Schema.String,
  sessions: Schema.Int,
  sameTurn: Schema.Int,
  jaccard: Schema.Number,
});

const SkillCoverageSchema = Schema.Struct({
  live: Schema.Int,
  transcript: Schema.Int,
  hybrid: Schema.Int,
  none: Schema.Int,
  partial: Schema.Int,
});

const SessionDigestSchema = Schema.Struct({
  id: Schema.String,
  parentID: Schema.optional(Schema.String),
  agent: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  title: Schema.optional(Schema.String),
  outcome: Schema.optional(Schema.Literals(["succeeded", "failed", "interrupted"])),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  cost: Schema.Number,
  tokens: TokensSchema,
  compacted: Schema.Boolean,
  userTurns: Schema.Int,
  assistantSteps: Schema.Int,
  compactions: Schema.Int,
  retries: Schema.Int,
  subagentsSpawned: Schema.Int,
  shellFailed: Schema.Int,
  skillsLoaded: Schema.Array(Schema.String),
  tools: Schema.Array(ToolStatSchema),
  anomalyScore: Schema.Number,
  telemetryCoverage: TelemetryCoverageSchema,
  telemetryPartial: Schema.optional(Schema.Boolean),
});

const CollectedOutput = Schema.Struct({
  status: Schema.Literals(["collected"]),
  project: Schema.String,
  windowDays: Schema.Number,
  cutoffAt: Schema.Number,
  scannedInWindow: Schema.Int,
  skippedAnalyzed: Schema.Int,
  remainingUnanalyzed: Schema.Int,
  trackedInStorage: Schema.Int,
  truncated: Schema.Boolean,
  unreadable: Schema.Array(Schema.String),
  totals: Schema.Struct({
    cost: Schema.Number,
    tokens: TokensSchema,
    toolCalls: Schema.Int,
    toolErrors: Schema.Int,
    retries: Schema.Int,
    compactions: Schema.Int,
  }),
  topTools: Schema.Array(ToolStatSchema),
  topSkills: Schema.Array(SkillStatSchema),
  skillCoUse: Schema.Array(SkillCoUseSchema),
  skillCoverage: SkillCoverageSchema,
  sessions: Schema.Array(SessionDigestSchema),
  papercuts: PapercutRollupSchema,
});

const InspectedCallSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  status: Schema.Literals(["streaming", "running", "completed", "error"]),
  inputPreview: Schema.String,
  outputPreview: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
});

const InspectedEventSchema = Schema.Struct({
  messageID: Schema.String,
  kind: Schema.Literals(["user", "skill", "shell", "assistant", "compaction", "idle"]),
  summary: Schema.String,
  calls: Schema.optional(Schema.Array(InspectedCallSchema)),
});

const InspectedSessionSchema = Schema.Struct({
  id: Schema.String,
  parentID: Schema.optional(Schema.String),
  agent: Schema.optional(Schema.String),
  title: Schema.optional(Schema.String),
  updatedAt: Schema.Number,
  events: Schema.Array(InspectedEventSchema),
});

const InspectedOutput = Schema.Struct({
  status: Schema.Literals(["inspected"]),
  sessions: Schema.Array(InspectedSessionSchema),
  missing: Schema.Array(Schema.String),
  unreadable: Schema.Array(Schema.String),
});

const MarkedOutput = Schema.Struct({
  status: Schema.Literals(["marked"]),
  project: Schema.String,
  marked: Schema.Int,
  updated: Schema.Int,
  missing: Schema.Array(Schema.String),
  trackedInStorage: Schema.Int,
});

export const NocturnaOutput = Schema.Union([CollectedOutput, InspectedOutput, MarkedOutput]);

const clampFinite = (
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number => {
  const chosen = value !== undefined && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, chosen));
};

interface CallerFilter {
  readonly sessionID: string | undefined;
  readonly parentID: string | undefined;
  readonly info: Session.Info | undefined;
}

interface PermissionRuleLike {
  readonly action: string;
  readonly resource: string;
  readonly effect: "allow" | "deny" | "ask";
}

const UNAVAILABLE_PAPERCUTS: PapercutRollup = {
  status: "unavailable",
  openGroups: 0,
  newReportsInWindow: 0,
  scanTruncated: false,
  topGroups: [],
};

const matchesPermissionPattern = (value: string, rawPattern: string): boolean => {
  const target = value.replaceAll("\\", "/");
  const normalized = rawPattern.replaceAll("\\", "/");
  const trailingOptional = normalized.endsWith(" *");
  const pattern = trailingOptional ? normalized.slice(0, -2) : normalized;
  let ti = 0;
  let pi = 0;
  let starPi = -1;
  let starTi = 0;

  while (ti < target.length) {
    const pc = pattern[pi];
    if (pc === "*") {
      starPi = pi;
      starTi = ti;
      pi += 1;
    } else if (pc === "?" || pc === target[ti]) {
      pi += 1;
      ti += 1;
    } else if (trailingOptional && pi === pattern.length && target[ti] === " ") {
      return true;
    } else if (starPi >= 0) {
      pi = starPi + 1;
      starTi += 1;
      ti = starTi;
    } else {
      return false;
    }
  }
  while (pattern[pi] === "*") pi += 1;
  return pi === pattern.length;
};

const matchesPapercutsRule = (rule: PermissionRuleLike): boolean =>
  matchesPermissionPattern("papercuts", rule.action) &&
  matchesPermissionPattern("*", rule.resource);

const evaluateConfiguredPapercuts = (
  agentRules: ReadonlyArray<PermissionRuleLike> | undefined,
  sessionRules: ReadonlyArray<PermissionRuleLike> | undefined,
): "allow" | "deny" | "ask" | undefined => {
  if (agentRules === undefined) {
    if (sessionRules === undefined || sessionRules.length === 0) return undefined;
    return sessionRules.findLast(matchesPapercutsRule)?.effect;
  }
  const combined = [...agentRules, ...(sessionRules ?? [])];
  return combined.findLast(matchesPapercutsRule)?.effect ?? "ask";
};

const loadAgentPermissions = (
  ctx: Plugin.Context,
  agentID: Agent.ID | undefined,
): Effect.Effect<ReadonlyArray<PermissionRuleLike> | undefined> => {
  const getAgent = ctx.agent?.get;
  if (typeof getAgent !== "function" || agentID === undefined) {
    return Effect.succeed(undefined);
  }
  return Effect.result(getAgent({ agentID })).pipe(
    Effect.map((res) => (Result.isSuccess(res) ? res.success.data.permissions : undefined)),
    Effect.catchCause(() => Effect.succeed(undefined)),
  );
};

const canReadPapercuts = (
  ctx: Plugin.Context,
  callerInfo: Session.Info | undefined,
  context: Tool.Context | undefined,
): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    const rawAgent = context?.agent ?? callerInfo?.agent;
    const agentID =
      typeof rawAgent === "string" && rawAgent.length > 0 ? Agent.ID.make(rawAgent) : undefined;
    const agentRules = yield* loadAgentPermissions(ctx, agentID);
    const configured = evaluateConfiguredPapercuts(agentRules, callerInfo?.permissions);
    if (configured === "deny" || configured === "ask") return false;

    const assertPermission = ctx.permission?.assert;
    if (typeof assertPermission !== "function") return true;

    const rawSessionID = context?.sessionID ?? callerInfo?.id;
    const parsedSessionID =
      rawSessionID === undefined ? undefined : Option.getOrUndefined(decodeSessionID(rawSessionID));
    if (parsedSessionID === undefined) return false;

    return yield* assertPermission({
      sessionID: parsedSessionID,
      ...(agentID === undefined ? {} : { agent: agentID }),
      action: "papercuts",
      resources: ["*"],
      ...(context?.messageID !== undefined && context?.id !== undefined
        ? { source: { type: "tool" as const, messageID: context.messageID, id: context.id } }
        : {}),
    }).pipe(
      Effect.as(true),
      Effect.catchCause(() => Effect.succeed(false)),
    );
  });

const isExcludedSession = (info: Session.Info, caller: CallerFilter): boolean => {
  if (info.agent === "nocturna") return true;
  if (caller.parentID !== undefined && info.id === caller.parentID) return true;
  if (caller.sessionID === undefined) return false;
  return info.id === caller.sessionID || info.parentID === caller.sessionID;
};

interface WindowScan {
  readonly pending: Array<Session.Info>;
  readonly scannedInWindow: number;
  readonly skippedAnalyzed: number;
  readonly truncated: boolean;
}

interface PageStep {
  readonly pending: Array<Session.Info>;
  readonly inWindow: number;
  readonly skipped: number;
  readonly reachedCutoff: boolean;
}

const partitionWindowPage = (
  rows: ReadonlyArray<Session.Info>,
  cutoffAt: number,
  caller: CallerFilter,
  ledger: ReadonlyMap<string, LedgerEntry>,
  includeAnalyzed: boolean,
): PageStep => {
  const pending: Array<Session.Info> = [];
  let inWindow = 0;
  let skipped = 0;

  for (const item of rows) {
    const updatedAt = toMillis(item.time.updated);
    if (updatedAt < cutoffAt) return { pending, inWindow, skipped, reachedCutoff: true };
    if (isExcludedSession(item, caller)) continue;
    inWindow += 1;
    const watermark = ledger.get(item.id)?.updatedAt;
    if (!includeAnalyzed && watermark !== undefined && watermark >= updatedAt) {
      skipped += 1;
    } else {
      pending.push(item);
    }
  }

  return { pending, inWindow, skipped, reachedCutoff: false };
};

const scanWindowSessions = (
  ctx: Plugin.Context,
  cutoffAt: number,
  caller: CallerFilter,
  ledger: ReadonlyMap<string, LedgerEntry>,
  includeAnalyzed: boolean,
): Effect.Effect<WindowScan, Tool.Error> =>
  Effect.gen(function* () {
    const pending: Array<Session.Info> = [];
    let scannedInWindow = 0;
    let skippedAnalyzed = 0;
    let rawScanned = 0;
    let cursor: Session.ListCursor | undefined;

    while (rawScanned < MAX_SCAN_ROWS) {
      const page = yield* Effect.result(
        ctx.session.list({
          project: ctx.location.project.id,
          order: "desc",
          limit: PAGE_SIZE,
          ...(cursor === undefined ? {} : { cursor }),
        }),
      );
      if (Result.isFailure(page)) {
        return yield* new Tool.Error({
          message: "Failed to list OpenCode sessions for Nocturna window.",
          error: page.failure,
        });
      }
      if (page.success.data.length === 0) {
        return { pending, scannedInWindow, skippedAnalyzed, truncated: false };
      }

      rawScanned += page.success.data.length;
      const step = partitionWindowPage(
        page.success.data,
        cutoffAt,
        caller,
        ledger,
        includeAnalyzed,
      );
      pending.push(...step.pending);
      scannedInWindow += step.inWindow;
      skippedAnalyzed += step.skipped;

      const next = page.success.cursor.next;
      if (step.reachedCutoff || next === undefined) {
        return { pending, scannedInWindow, skippedAnalyzed, truncated: false };
      }
      cursor = next;
    }

    return { pending, scannedInWindow, skippedAnalyzed, truncated: true };
  });

const aggregateTools = (digests: ReadonlyArray<SessionDigest>): Array<ToolStat> => {
  const merged = new Map<string, { calls: number; errors: number; sampleError?: string }>();
  for (const session of digests) {
    for (const tool of session.tools) {
      const cur = merged.get(tool.name) ?? { calls: 0, errors: 0 };
      cur.calls += tool.calls;
      cur.errors += tool.errors;
      if (cur.sampleError === undefined && tool.sampleError !== undefined) {
        cur.sampleError = tool.sampleError;
      }
      merged.set(tool.name, cur);
    }
  }
  return [...merged.entries()]
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
    )
    .slice(0, 20);
};

const round2 = (value: number): number => Math.round(value * 100) / 100;
const round4 = (value: number): number => Math.round(value * 10_000) / 10_000;
const round6 = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;

interface MutableSkillStat {
  readonly sessions: Set<string>;
  invocations: number;
  agentTool: number;
  promptAttachment: number;
  apiActivation: number;
  loadErrors: number;
  attributedCost: number;
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  unmeasuredSteps: number;
  postLoadErrors: number;
}

const emptySkillStat = (): MutableSkillStat => ({
  sessions: new Set<string>(),
  invocations: 0,
  agentTool: 0,
  promptAttachment: 0,
  apiActivation: 0,
  loadErrors: 0,
  attributedCost: 0,
  input: 0,
  output: 0,
  reasoning: 0,
  cacheRead: 0,
  cacheWrite: 0,
  unmeasuredSteps: 0,
  postLoadErrors: 0,
});

const accumulateSkillLoads = (
  bySkill: Map<string, MutableSkillStat>,
  sessionID: string,
  loads: SessionDigestResult["telemetry"]["loads"],
): void => {
  for (const load of loads) {
    let stat = bySkill.get(load.skill);
    if (stat === undefined) {
      stat = emptySkillStat();
      bySkill.set(load.skill, stat);
    }
    if (load.status === "error") {
      stat.loadErrors += 1;
      continue;
    }
    stat.sessions.add(sessionID);
    stat.invocations += 1;
    if (load.trigger === "agent-tool") stat.agentTool += 1;
    else if (load.trigger === "prompt-attachment") stat.promptAttachment += 1;
    else stat.apiActivation += 1;
  }
};

const accumulateSkillSteps = (
  bySkill: Map<string, MutableSkillStat>,
  steps: SessionDigestResult["telemetry"]["steps"],
): void => {
  for (const step of steps) {
    if (step.skills.length === 0) continue;
    const share = 1 / step.skills.length;
    const stepCost = step.cost;
    const stepTokens = step.tokens;
    for (const skill of step.skills) {
      let stat = bySkill.get(skill);
      if (stat === undefined) {
        stat = emptySkillStat();
        bySkill.set(skill, stat);
      }
      if (stepCost !== undefined && stepTokens !== undefined) {
        stat.attributedCost += stepCost * share;
        stat.input += stepTokens.input * share;
        stat.output += stepTokens.output * share;
        stat.reasoning += stepTokens.reasoning * share;
        stat.cacheRead += stepTokens.cacheRead * share;
        stat.cacheWrite += stepTokens.cacheWrite * share;
      } else {
        stat.unmeasuredSteps += 1;
      }
      stat.postLoadErrors += step.postLoadErrors;
    }
  }
};

const aggregateSkills = (
  items: ReadonlyArray<SessionDigestResult>,
): Array<typeof SkillStatSchema.Type> => {
  const bySkill = new Map<string, MutableSkillStat>();
  for (const item of items) {
    accumulateSkillLoads(bySkill, item.digest.id, item.telemetry.loads);
    accumulateSkillSteps(bySkill, item.telemetry.steps);
  }

  return [...bySkill.entries()]
    .map(([skill, stat]) => ({
      skill,
      sessions: stat.sessions.size,
      invocations: stat.invocations,
      triggers: {
        "agent-tool": stat.agentTool,
        "prompt-attachment": stat.promptAttachment,
        "api-activation": stat.apiActivation,
      },
      loadErrors: stat.loadErrors,
      attributedCost: round6(stat.attributedCost),
      attributedTokens: {
        input: round2(stat.input),
        output: round2(stat.output),
        reasoning: round2(stat.reasoning),
        cacheRead: round2(stat.cacheRead),
        cacheWrite: round2(stat.cacheWrite),
      },
      unmeasuredSteps: stat.unmeasuredSteps,
      postLoadErrors: stat.postLoadErrors,
    }))
    .toSorted(
      (left, right) => right.sessions - left.sessions || left.skill.localeCompare(right.skill),
    )
    .slice(0, 20);
};

interface MutableCoUse {
  readonly left: string;
  readonly right: string;
  sessions: number;
  sameTurn: number;
}

const incrementPairs = (
  pairs: Map<string, MutableCoUse>,
  skills: ReadonlyArray<string>,
  field: "sessions" | "sameTurn",
): void => {
  for (let i = 0; i < skills.length; i += 1) {
    const left = skills[i];
    if (left === undefined) continue;
    for (let j = i + 1; j < skills.length; j += 1) {
      const right = skills[j];
      if (right === undefined) continue;
      const key = `${left}\0${right}`;
      const existing = pairs.get(key) ?? { left, right, sessions: 0, sameTurn: 0 };
      existing[field] += 1;
      pairs.set(key, existing);
    }
  }
};

const collectTurnSkillSets = (
  telemetry: SessionDigestResult["telemetry"],
): Map<string, Set<string>> => {
  const byTurn = new Map<string, Set<string>>();
  for (const load of telemetry.loads) {
    if (load.status !== "completed") continue;
    const set = byTurn.get(load.turnID) ?? new Set<string>();
    set.add(load.skill);
    byTurn.set(load.turnID, set);
  }
  for (const step of telemetry.steps) {
    const set = byTurn.get(step.turnID) ?? new Set<string>();
    for (const skill of step.skills) set.add(skill);
    byTurn.set(step.turnID, set);
  }
  return byTurn;
};

const aggregateSkillCoUse = (
  items: ReadonlyArray<SessionDigestResult>,
): Array<typeof SkillCoUseSchema.Type> => {
  const skillSessions = new Map<string, number>();
  const pairs = new Map<string, MutableCoUse>();

  for (const item of items) {
    const sessionSkills = [...new Set(item.digest.skillsLoaded)].toSorted();
    for (const skill of sessionSkills) {
      skillSessions.set(skill, (skillSessions.get(skill) ?? 0) + 1);
    }
    incrementPairs(pairs, sessionSkills, "sessions");
    for (const turnSkills of collectTurnSkillSets(item.telemetry).values()) {
      incrementPairs(pairs, [...turnSkills].toSorted(), "sameTurn");
    }
  }

  return [...pairs.values()]
    .map((pair) => {
      const union =
        (skillSessions.get(pair.left) ?? 0) + (skillSessions.get(pair.right) ?? 0) - pair.sessions;
      return {
        left: pair.left,
        right: pair.right,
        sessions: pair.sessions,
        sameTurn: pair.sameTurn,
        jaccard: union > 0 ? round4(pair.sessions / union) : 0,
      };
    })
    .toSorted(
      (left, right) =>
        right.sessions - left.sessions ||
        right.sameTurn - left.sameTurn ||
        left.left.localeCompare(right.left) ||
        left.right.localeCompare(right.right),
    )
    .slice(0, 20);
};

const summarizeSkillCoverage = (
  digests: ReadonlyArray<SessionDigest>,
): typeof SkillCoverageSchema.Type => {
  let live = 0;
  let transcript = 0;
  let hybrid = 0;
  let none = 0;
  let partial = 0;

  for (const item of digests) {
    if (item.telemetryCoverage === "live") live += 1;
    else if (item.telemetryCoverage === "transcript") transcript += 1;
    else if (item.telemetryCoverage === "hybrid") hybrid += 1;
    else none += 1;
    if (item.telemetryPartial === true) partial += 1;
  }

  return { live, transcript, hybrid, none, partial };
};

const sumTotals = (digests: ReadonlyArray<SessionDigest>) => {
  let cost = 0;
  let input = 0;
  let output = 0;
  let reasoning = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let toolCalls = 0;
  let toolErrors = 0;
  let retries = 0;
  let compactions = 0;

  for (const one of digests) {
    cost += one.cost;
    input += one.tokens.input;
    output += one.tokens.output;
    reasoning += one.tokens.reasoning;
    cacheRead += one.tokens.cacheRead;
    cacheWrite += one.tokens.cacheWrite;
    retries += one.retries;
    compactions += one.compactions;
    for (const tool of one.tools) {
      toolCalls += tool.calls;
      toolErrors += tool.errors;
    }
  }

  return {
    cost,
    tokens: { input, output, reasoning, cacheRead, cacheWrite },
    toolCalls,
    toolErrors,
    retries,
    compactions,
  };
};

const resolveProjectSession = (
  ctx: Plugin.Context,
  rawId: string,
): Effect.Effect<Session.Info | undefined> =>
  Effect.gen(function* () {
    const parsed = Option.getOrUndefined(decodeSessionID(rawId));
    if (parsed === undefined) return undefined;
    const infoRes = yield* Effect.result(ctx.session.get({ sessionID: parsed }));
    if (Result.isFailure(infoRes)) return undefined;
    if (infoRes.success.projectID !== ctx.location.project.id) return undefined;
    return infoRes.success;
  });

const activeTokens = (info: Session.Info): number =>
  info.tokens.input + info.tokens.output + info.tokens.reasoning;

const comparePending = (left: Session.Info, right: Session.Info): number =>
  (right.outcome === "failed" ? 1 : 0) - (left.outcome === "failed" ? 1 : 0) ||
  activeTokens(right) - activeTokens(left) ||
  right.cost - left.cost ||
  toMillis(right.time.updated) - toMillis(left.time.updated);

const resolveCallerFilter = (
  ctx: Plugin.Context,
  callerSessionID: string | undefined,
): Effect.Effect<CallerFilter> =>
  Effect.gen(function* () {
    if (callerSessionID === undefined) {
      return { sessionID: undefined, parentID: undefined, info: undefined };
    }
    const info = yield* resolveProjectSession(ctx, callerSessionID);
    return { sessionID: callerSessionID, parentID: info?.parentID, info };
  });

const digestBatch = (
  ctx: Plugin.Context,
  batch: ReadonlyArray<Session.Info>,
): Effect.Effect<{
  readonly ranked: Array<SessionDigestResult>;
  readonly unreadable: Array<string>;
}> =>
  Effect.gen(function* () {
    const digests: Array<SessionDigestResult> = [];
    const unreadable: Array<string> = [];
    for (const session of batch) {
      const history = yield* Effect.result(ctx.session.context({ sessionID: session.id }));
      if (Result.isFailure(history)) {
        unreadable.push(session.id);
        continue;
      }
      const live = yield* readSessionTelemetry(ctx.storage, session.id);
      digests.push(digestSession(session, history.success, live));
    }
    const ranked = digests.toSorted(
      (left, right) =>
        right.digest.anomalyScore - left.digest.anomalyScore ||
        right.digest.updatedAt - left.digest.updatedAt,
    );
    return { ranked, unreadable };
  });

const collectVisiblePapercuts = (
  ctx: Plugin.Context,
  callerInfo: Session.Info | undefined,
  context: Tool.Context | undefined,
  cutoffAt: number,
): Effect.Effect<PapercutRollup> =>
  canReadPapercuts(ctx, callerInfo, context).pipe(
    Effect.flatMap((allowed) =>
      allowed ? summarizeOpenPapercuts(ctx, cutoffAt) : Effect.succeed(UNAVAILABLE_PAPERCUTS),
    ),
  );

const runCollect = (
  ctx: Plugin.Context,
  input: typeof CollectInput.Type,
  context: Tool.Context | undefined,
  now: number,
) =>
  Effect.gen(function* () {
    const project = ctx.location.project.id;
    const windowDays = clampFinite(input.days, DEFAULT_DAYS, 1, 90);
    const limit = clampFinite(input.limit, DEFAULT_LIMIT, 1, PAGE_SIZE);
    const offset = Math.floor(clampFinite(input.offset, 0, 0, Number.MAX_SAFE_INTEGER));
    const cutoffAt = now - windowDays * DAY_MS;

    yield* pruneSkillTelemetry(ctx.storage, project, now);

    const caller = yield* resolveCallerFilter(ctx, context?.sessionID);
    const ledger = yield* openLedger(ctx.storage, project, now);
    const scanned = yield* scanWindowSessions(
      ctx,
      cutoffAt,
      caller,
      ledger,
      Boolean(input.includeAnalyzed),
    );

    const ordered =
      scanned.pending.length > limit || offset > 0
        ? scanned.pending.toSorted(comparePending)
        : scanned.pending;
    const batch = ordered.slice(offset, offset + limit);
    const { ranked, unreadable } = yield* digestBatch(ctx, batch);
    const digests = ranked.map((item) => item.digest);
    const papercuts = yield* collectVisiblePapercuts(ctx, caller.info, context, cutoffAt);

    const output: typeof CollectedOutput.Type = {
      status: "collected",
      project,
      windowDays,
      cutoffAt,
      scannedInWindow: scanned.scannedInWindow,
      skippedAnalyzed: scanned.skippedAnalyzed,
      remainingUnanalyzed: Math.max(0, scanned.pending.length - (offset + batch.length)),
      trackedInStorage: ledger.size,
      truncated: scanned.truncated,
      unreadable,
      totals: sumTotals(digests),
      topTools: aggregateTools(digests),
      topSkills: aggregateSkills(ranked),
      skillCoUse: aggregateSkillCoUse(ranked),
      skillCoverage: summarizeSkillCoverage(digests),
      sessions: digests,
      papercuts,
    };

    const papercutNote =
      papercuts.status === "unavailable"
        ? " Papercuts: unavailable."
        : ` Papercuts: ${papercuts.openGroups} open (${papercuts.newReportsInWindow} new in window${papercuts.scanTruncated ? ", truncated" : ""}).`;

    return {
      output,
      content: `Collected ${digests.length} session(s) across ${windowDays}d (${scanned.skippedAnalyzed} skipped, ${output.remainingUnanalyzed} remaining, ${unreadable.length} unreadable).${papercutNote}`,
    };
  });

const runInspect = (ctx: Plugin.Context, input: typeof InspectInput.Type) =>
  Effect.gen(function* () {
    const maxChars = clampFinite(input.maxChars, DEFAULT_MAX_CHARS, 80, 2_000);
    const ids = [...new Set(input.sessions)].slice(0, 10);
    const sessions: Array<typeof InspectedSessionSchema.Type> = [];
    const missing: Array<string> = [];
    const unreadable: Array<string> = [];

    for (const rawId of ids) {
      const info = yield* resolveProjectSession(ctx, rawId);
      if (info === undefined) {
        missing.push(rawId);
        continue;
      }
      const historyRes = yield* Effect.result(ctx.session.context({ sessionID: info.id }));
      if (Result.isFailure(historyRes)) {
        unreadable.push(rawId);
        continue;
      }
      sessions.push({
        id: info.id,
        ...(info.parentID === undefined ? {} : { parentID: info.parentID }),
        ...(info.agent === undefined ? {} : { agent: info.agent }),
        ...(info.title === undefined ? {} : { title: info.title }),
        updatedAt: toMillis(info.time.updated),
        events: inspectMessages(historyRes.success, maxChars),
      });
    }

    const output: typeof InspectedOutput.Type = {
      status: "inspected",
      sessions,
      missing,
      unreadable,
    };

    return {
      output,
      content: `Inspected ${sessions.length} session(s) (${missing.length} missing, ${unreadable.length} unreadable).`,
    };
  });

const runMark = (ctx: Plugin.Context, input: typeof MarkInput.Type, now: number) =>
  Effect.gen(function* () {
    const project = ctx.location.project.id;
    const ids = [...new Set(input.sessions)];
    const updates: Array<{ readonly session: string; readonly updatedAt: number }> = [];
    const missing: Array<string> = [];

    for (const rawId of ids) {
      const info = yield* resolveProjectSession(ctx, rawId);
      if (info === undefined) {
        missing.push(rawId);
      } else {
        updates.push({
          session: info.id,
          updatedAt: toMillis(info.time.updated),
        });
      }
    }

    const saved = yield* markLedger(ctx.storage, project, updates, now);
    const output: typeof MarkedOutput.Type = {
      status: "marked",
      project,
      marked: saved.marked,
      updated: saved.updated,
      missing,
      trackedInStorage: saved.trackedInStorage,
    };

    return {
      output,
      content: `Marked ${saved.marked} new and ${saved.updated} updated session(s) in storage (${saved.trackedInStorage} tracked).`,
    };
  });

const DESCRIPTION = `Collect, inspect, and watermark past OpenCode sessions for Nocturna audits over a rolling lookback window.
Uses ctx.session to digest root and subagent token spend, tool errors, retries, compactions, and loaded skills over the last 7 days by default, and tracks analyzed session updatedAt watermarks in ctx.storage so unchanged sessions are skipped until resumed.`;

export const nocturnaTool = (
  ctx: Plugin.Context,
  clock: () => number = Date.now,
): Tool.Info<typeof NocturnaInput, typeof NocturnaOutput> => ({
  name: "nocturna",
  description: DESCRIPTION,
  options: {
    namespace: "spectre",
    codemode: true,
    permission: "read",
  },
  input: NocturnaInput,
  output: NocturnaOutput,
  execute: (input, context) => {
    const now = clock();
    if (input.action === "inspect") return runInspect(ctx, input);
    if (input.action === "mark") return runMark(ctx, input, now);
    return runCollect(ctx, input, context, now);
  },
});
