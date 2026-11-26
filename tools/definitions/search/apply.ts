import { type Agent, type Plugin, Tool } from "@opencode/plugin/effect";
import { InstructionEntry } from "@opencode/schema/instruction-entry";
import type { Session } from "@opencode/schema/session";
import type { SessionMessage } from "@opencode/schema/session-message";
import { Effect, type Scope } from "effect";
import { isSpectre } from "./agents";
import { shape } from "./catalogue";
import { CONTRACT, END_OF_WORK } from "./contract";
import { legendSeenFile, recordLegendSeen } from "./legend";
import {
  type Ask,
  contextRule,
  type Decision,
  decide,
  decideShellRead,
  decideShunt,
  type Env,
  type Health,
  type Memory,
  type ShellAsk,
  SPECTRE_DELETE_REFUSAL,
  type TextAsk,
  type Verdict,
} from "./policy";
import { probe } from "./probe";
import { rootOf, sessionScopeOf } from "./root";
import { scope } from "./run";
import {
  classifyFormat,
  countLines,
  readShuntConfig,
  type ShuntConfig,
  type ShuntFormat,
  type SummaryAttempt,
  summarizeFile,
} from "./shunt";
import {
  contextAsk,
  decodeReadInput,
  grepAsk,
  inspectReadResult,
  isControlPlanePath,
  mutateAsk,
  type ReadInputParsed,
  type ReadResultShape,
  readAsk,
  shellAsk,
} from "./signals";
import { markRerouted, memories, memoryOf, remember } from "./state";

/**
 * The appliers. A verdict is a decision; this file is what it costs on the host:
 * the two permission asserts and the tool rename for a reroute, and the prose rule
 * and catalogue for a request. `decide` never touches the host.
 */

/** The `execute.before` event, as far as the applier reads it. */
export interface ToolBefore {
  tool: string;
  readonly sessionID: Session.ID;
  readonly agent: Agent.ID;
  readonly messageID: SessionMessage.ID;
  readonly id: Tool.CallID;
  input: unknown;
}

export const envOf = (health: Health): Env => ({ health });

/* The text payload's two asserts, and the shell payload's: the action the model
 * asked for, then the read the renamed tool will run. */
interface RerouteAsks {
  readonly action: "grep" | "shell";
  readonly resources: ReadonlyArray<string>;
  readonly read: string;
  readonly metadata: Record<string, string>;
}

const textAsks = (ask: TextAsk, root: string): RerouteAsks => ({
  action: "grep",
  resources: [ask.pattern],
  read: ask.path ?? root,
  metadata: {
    ...(ask.path === undefined ? {} : { path: ask.path }),
    ...(ask.include === undefined ? {} : { include: ask.include }),
  },
});

const shellAsks = (parsed: ShellAsk, command: string, root: string): RerouteAsks | undefined => {
  if (parsed.kind !== "search") return undefined;
  return {
    action: "shell",
    resources: [command],
    read: parsed.path ?? root,
    metadata: parsed.path === undefined ? {} : { path: parsed.path },
  };
};

const assertSearch = (
  ctx: Plugin.Context,
  event: ToolBefore,
  asks: RerouteAsks,
): Effect.Effect<void, Tool.Error> =>
  Effect.gen(function* () {
    yield* ctx.permission.assert({
      sessionID: event.sessionID,
      agent: event.agent,
      action: asks.action,
      resources: [...asks.resources],
      save: ["*"],
      metadata: asks.metadata,
      source: { type: "tool", messageID: event.messageID, id: event.id },
    });

    yield* ctx.permission.assert({
      sessionID: event.sessionID,
      agent: event.agent,
      action: "read",
      resources: [asks.read],
      save: ["*"],
      metadata: asks.metadata,
      source: { type: "tool", messageID: event.messageID, id: event.id },
    });
  });

/**
 * The reroute: assert both the action the model asked for and the action the
 * renamed tool will take, record the call id, then rename in place.
 */
const applyReroute = (
  ctx: Plugin.Context,
  event: ToolBefore,
  asks: RerouteAsks,
  verdict: Extract<Verdict, { kind: "reroute" }>,
): Effect.Effect<void, Tool.Error> =>
  Effect.gen(function* () {
    yield* assertSearch(ctx, event, asks);
    markRerouted(event.id, verdict.origin);
    event.input = verdict.input;
    event.tool = "spectre_search";
  });

const FILE_PATH_TOOLS: ReadonlySet<string> = new Set(["read", "edit", "write"]);

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

const repairToolInput = (event: ToolBefore): void => {
  if (!FILE_PATH_TOOLS.has(event.tool) || !isPlainObject(event.input)) return;
  if (typeof event.input.file === "string" && event.input.path === undefined) {
    event.input.path = event.input.file;
    delete event.input.file;
  }
};

const prLandingAsk = (input: unknown): Ask | undefined => {
  if (!isPlainObject(input) || input.action === "compose") return undefined;
  return {
    surface: "shell",
    command: "spectre_pr",
    parsed: { kind: "landing", command: "spectre_pr" },
  };
};

/** One reader per call: the shipped `askOf`, or a test that proves the gate depends on it. */
export type AskReader = (event: ToolBefore) => Ask | undefined;

/** The surface this call names, or `undefined` when the call is not one the rule reads. */
const askOf = (root: string, event: ToolBefore): Ask | undefined => {
  const text = grepAsk(event.input, event.tool);
  if (text !== undefined) return text;
  switch (event.tool) {
    case "shell":
      return shellAsk(event.input);
    case "read":
      return readAsk(event.input, root);
    case "edit":
    case "write":
      return mutateAsk(event.input, event.tool, root);
    case "spectre_pr":
      return prLandingAsk(event.input);
    default:
      return undefined;
  }
};

const healthOf = (): Effect.Effect<Health | undefined> =>
  Effect.promise(() => probe()).pipe(
    Effect.catchDefect((defect) =>
      Effect.logWarning("search guard could not probe ripwire", { defect }).pipe(
        Effect.as(undefined),
      ),
    ),
  );

const END_OF_WORK_KEY = InstructionEntry.Key.make("spectre.end-of-work");
const MAX_SYNCED = 256;

export const endOfWorkSynced: Set<Session.ID> = new Set();

export const needsEndOfWork = (memory: Memory, health: Health): boolean => {
  if (health.kind !== "ready") return false;
  const { verdict } = decide({ surface: "context", tools: [] }, memory, envOf(health));
  return verdict.kind === "prose" && verdict.key === "end-of-work";
};

export const syncEndOfWork = (
  ctx: Plugin.Context,
  sessionID: Session.ID,
  active: boolean,
): Effect.Effect<void> => {
  const entry = ctx.session?.instructions?.entry;
  if (entry === undefined) return Effect.void;
  const present = endOfWorkSynced.has(sessionID);
  if (active === present) return Effect.void;
  if (active) {
    return entry.put({ sessionID, key: END_OF_WORK_KEY, value: END_OF_WORK }).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          if (endOfWorkSynced.size >= MAX_SYNCED) {
            const oldest = endOfWorkSynced.values().next();
            if (!oldest.done) endOfWorkSynced.delete(oldest.value);
          }
          endOfWorkSynced.add(sessionID);
        }),
      ),
      Effect.catchCause((cause) =>
        Effect.logWarning("search end-of-work put failed", { sessionID, cause }).pipe(
          Effect.asVoid,
        ),
      ),
    );
  }
  return entry.remove({ sessionID, key: END_OF_WORK_KEY }).pipe(
    Effect.tap(() =>
      Effect.sync(() => {
        endOfWorkSynced.delete(sessionID);
      }),
    ),
    Effect.catchCause((cause) =>
      Effect.logWarning("search end-of-work remove failed", { sessionID, cause }).pipe(
        Effect.asVoid,
      ),
    ),
  );
};

export const syncEndOfWorkFromMemory = (
  ctx: Plugin.Context,
  sessionID: Session.ID,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const memory = memories.get(sessionID);
    if (memory === undefined) {
      if (endOfWorkSynced.has(sessionID)) yield* syncEndOfWork(ctx, sessionID, false);
      return;
    }
    if (!endOfWorkSynced.has(sessionID) && memory.editedCode.size === 0) return;
    const health = yield* healthOf();
    if (health === undefined) return;
    yield* syncEndOfWork(ctx, sessionID, needsEndOfWork(memory, health));
  });

const rerouteAsksOf = (ask: Ask, root: string): RerouteAsks | undefined => {
  if (ask.surface === "text") return textAsks(ask.ask, root);
  if (ask.surface === "shell") return shellAsks(ask.parsed, ask.command, root);
  return undefined;
};

interface GuardStep {
  readonly ctx: Plugin.Context;
  readonly event: ToolBefore;
  readonly root: string;
  readonly childSubagent: boolean;
  readonly ask: Ask;
  readonly prev: Memory;
  readonly decision: Decision;
  readonly health: Health;
}

const applyRefusal = (
  step: GuardStep,
  verdict: Extract<Verdict, { readonly kind: "refuse" }>,
): Effect.Effect<void, Tool.Error> =>
  Effect.gen(function* () {
    if (verdict.gate === "read" && step.childSubagent) {
      const bypassed = { ...step.prev, reads: step.prev.reads + 1 };
      remember(step.event.sessionID, bypassed);
      yield* syncEndOfWork(step.ctx, step.event.sessionID, needsEndOfWork(bypassed, step.health));
      return;
    }
    remember(step.event.sessionID, step.decision.next);
    yield* Effect.fail(new Tool.Error({ message: verdict.message }));
  });

const applyVerdict = (step: GuardStep): Effect.Effect<void, Tool.Error> =>
  Effect.gen(function* () {
    const { verdict } = step.decision;
    if (verdict.kind === "refuse") {
      yield* applyRefusal(step, verdict);
      return;
    }
    if (verdict.kind === "reroute") {
      const asks = rerouteAsksOf(step.ask, step.root);
      if (asks !== undefined) yield* applyReroute(step.ctx, step.event, asks, verdict);
    }
    remember(step.event.sessionID, step.decision.next);
    yield* syncEndOfWork(
      step.ctx,
      step.event.sessionID,
      needsEndOfWork(step.decision.next, step.health),
    );
  });

const resolveAsk = (root: string, event: ToolBefore, read?: AskReader): Ask | undefined =>
  read === undefined ? askOf(root, event) : read(event);

export const isShuntAgent = (agent: string): boolean =>
  isSpectre(agent) && agent !== "nocturna" && agent !== "sicko";

const isLargeFile = async (resolved: string, cfg: ShuntConfig): Promise<boolean> => {
  try {
    const file = Bun.file(resolved);
    const stat = await file.stat();
    if (!stat.isFile()) return false;
    if (stat.size >= cfg.minBytes) return true;
    const text = await file.slice(0, cfg.minBytes).text();
    return countLines(text) >= cfg.minLines;
  } catch {
    return false;
  }
};

const resolveShellReadPath = (
  root: string,
  path: string,
  workdir?: string,
): string | undefined => {
  if (workdir === undefined) return scope(root, path);
  const base = scope(root, workdir);
  if (base === undefined) return undefined;
  const resolved = scope(base, path);
  return resolved !== undefined && scope(root, resolved) !== undefined ? resolved : undefined;
};

const isSmallShellSlice = (
  parsed: Extract<ShellAsk, { readonly kind: "read" }>,
  cfg: ShuntConfig,
): boolean =>
  (parsed.boundedLines !== undefined && parsed.boundedLines < cfg.minLines) ||
  (parsed.boundedBytes !== undefined && parsed.boundedBytes < cfg.minBytes);

interface ShellReadStep {
  readonly event: ToolBefore;
  readonly root: string;
  readonly parsed: Extract<ShellAsk, { readonly kind: "read" }>;
  readonly workdir?: string;
  readonly prev: Memory;
  readonly health: Health;
}

const guardShellRead = (step: ShellReadStep): Effect.Effect<void, Tool.Error> =>
  Effect.gen(function* () {
    if (!isShuntAgent(step.event.agent)) return;
    const cfg = readShuntConfig();
    if (isSmallShellSlice(step.parsed, cfg)) return;
    const resolved = resolveShellReadPath(step.root, step.parsed.path, step.workdir);
    if (resolved === undefined || isControlPlanePath(step.parsed.path, resolved, step.root)) return;
    const large = yield* Effect.promise(() => isLargeFile(resolved, cfg)).pipe(
      Effect.catchCause(() => Effect.succeed(false)),
    );
    if (!large) return;
    const shellDecision = decideShellRead(resolved, step.parsed.path, step.prev, step.health);
    if (shellDecision.verdict.kind !== "refuse") return;
    remember(step.event.sessionID, shellDecision.next);
    return yield* Effect.fail(new Tool.Error({ message: shellDecision.verdict.message }));
  });

const guardBefore = (
  ctx: Plugin.Context,
  event: ToolBefore,
  read?: AskReader,
): Effect.Effect<void, Tool.Error> =>
  Effect.gen(function* () {
    repairToolInput(event);
    if (!isSpectre(event.agent)) return;
    const sessionScope = yield* sessionScopeOf(ctx, event.sessionID);
    const ask = resolveAsk(sessionScope.directory, event, read);
    if (ask === undefined) return;
    if (ask.surface === "shell" && ask.parsed.kind === "destructive") {
      return yield* Effect.fail(new Tool.Error({ message: SPECTRE_DELETE_REFUSAL }));
    }
    const health = yield* healthOf();
    if (health === undefined) return;
    const prev = memoryOf(event.sessionID);
    if (ask.surface === "shell" && ask.parsed.kind === "read") {
      yield* guardShellRead({
        event,
        root: sessionScope.directory,
        parsed: ask.parsed,
        workdir: ask.workdir,
        prev,
        health,
      });
    }
    const decision = decide(ask, prev, envOf(health));
    yield* applyVerdict({
      ctx,
      event,
      root: sessionScope.directory,
      childSubagent: event.agent !== "spectre" || sessionScope.hasParent,
      ask,
      prev,
      decision,
      health,
    });
  });

export type ToolAfter = {
  readonly tool: string;
  readonly sessionID: Session.ID;
  readonly agent: Agent.ID;
  readonly input: unknown;
  readonly codemode?: boolean;
} & ({ readonly status: "completed"; readonly result: Tool.Result } | { readonly status: "error" });

export interface ShuntTelemetryEvent {
  readonly bytesRaw: number;
  readonly bytesServed: number;
  readonly summarized: boolean;
  readonly escalation: boolean;
}

type MutableToolResult = {
  output?: unknown;
  content?: string | ReadonlyArray<Tool.Content>;
  metadata?: Tool.Metadata;
};

const isTextOutput = (
  value: unknown,
): value is Record<string, unknown> & { readonly type: "text"; readonly content: string } =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  "type" in value &&
  value.type === "text" &&
  "content" in value &&
  typeof value.content === "string";

type SummarizedAttempt = Extract<SummaryAttempt, { readonly kind: "summarized" }>;

const mutateReadResult = (result: Tool.Result, attempt: SummarizedAttempt): void => {
  const mutableResult = result as MutableToolResult;
  mutableResult.content = attempt.text;
  if (isTextOutput(result.output)) {
    const { next: _next, ...rest } = result.output;
    mutableResult.output = { ...rest, content: attempt.text };
  }
  const { truncated: _truncated, ...restMeta } = result.metadata ?? {};
  mutableResult.metadata = {
    ...restMeta,
    spectreShunt: { bytesRaw: attempt.rawBytes, bytesServed: attempt.servedBytes },
  };
};

const shuntMutateAfter = (root: string, event: ToolAfter): undefined => {
  const parsed = decodeReadInput(event.input);
  if (parsed === undefined) return undefined;
  const resolved = scope(root, parsed.path);
  if (resolved === undefined) return undefined;
  const prev = memoryOf(event.sessionID);
  const shunted = new Map(prev.shunted);
  shunted.set(resolved, { kind: "edited" });
  remember(event.sessionID, { ...prev, shunted });
  return undefined;
};

const MAX_DISK_READ_BYTES = 2 * 1024 * 1024;

interface DiskFile {
  readonly size: number;
  readonly file: ReturnType<typeof Bun.file>;
}

const statDiskFile = async (resolved: string): Promise<DiskFile | undefined> => {
  try {
    const file = Bun.file(resolved);
    const stat = await file.stat();
    return stat.isFile() ? { size: stat.size, file } : undefined;
  } catch {
    return undefined;
  }
};

interface SummarySource {
  readonly rawText: string;
  readonly rawBytes: number;
  readonly pageBytes: number;
  readonly lines: number;
  readonly format: ShuntFormat;
}

const estimateLines = (shape: ReadResultShape, effectiveBytes: number): number =>
  shape.rawBytes > 0
    ? Math.max(shape.lines, Math.round((shape.lines * effectiveBytes) / shape.rawBytes))
    : shape.lines;

interface ResolveSourceInput {
  readonly resolved: string;
  readonly shape: ReadResultShape;
  readonly health: Health;
  readonly cfg: ShuntConfig;
  readonly disk: DiskFile | undefined;
}

const readDiskSource = async (
  input: ResolveSourceInput,
  effectiveBytes: number,
  disk: DiskFile,
): Promise<SummarySource | undefined> => {
  try {
    const fullText = await disk.file.text();
    const lines = countLines(fullText);
    return {
      rawText: fullText,
      rawBytes: effectiveBytes,
      pageBytes: input.shape.rawBytes,
      lines,
      format: classifyFormat(input.resolved, lines, effectiveBytes, input.cfg),
    };
  } catch {
    return undefined;
  }
};

const resolveSummarySource = async (
  input: ResolveSourceInput,
): Promise<SummarySource | undefined> => {
  const { resolved, shape, health, cfg, disk } = input;
  const diskSize = disk?.size ?? 0;
  const effectiveBytes = Math.max(shape.rawBytes, diskSize);
  const initialFormat = classifyFormat(resolved, shape.lines, effectiveBytes, cfg);
  if (!shape.truncatedByHost && diskSize <= shape.rawBytes) {
    return {
      rawText: shape.rawText,
      rawBytes: shape.rawBytes,
      pageBytes: shape.rawBytes,
      lines: shape.lines,
      format: initialFormat,
    };
  }
  const usesRipwire =
    health.kind === "ready" && (initialFormat.kind === "code" || initialFormat.kind === "markdown");
  if (disk === undefined || disk.size > MAX_DISK_READ_BYTES) {
    if (!usesRipwire) return undefined;
    const lines = estimateLines(shape, effectiveBytes);
    return {
      rawText: "",
      rawBytes: effectiveBytes,
      pageBytes: shape.rawBytes,
      lines,
      format: classifyFormat(resolved, lines, effectiveBytes, cfg),
    };
  }
  return readDiskSource(input, effectiveBytes, disk);
};

const maybeStatDisk = (
  resolved: string | undefined,
  readInput: ReadInputParsed,
  root: string,
  shape: ReadResultShape,
): Effect.Effect<DiskFile | undefined> => {
  if (resolved === undefined || shape.kind !== "text") return Effect.succeed(undefined);
  if (readInput.offset !== undefined || readInput.limit !== undefined) {
    return Effect.succeed(undefined);
  }
  if (isControlPlanePath(readInput.path, resolved, root)) return Effect.succeed(undefined);
  return Effect.promise(() => statDiskFile(resolved)).pipe(
    Effect.catchCause(() => Effect.succeed(undefined)),
  );
};

interface ShuntDecisionContext {
  readonly readInput: ReadInputParsed;
  readonly resolved: string | undefined;
  readonly root: string;
  readonly shape: ReadResultShape;
  readonly diskSize: number;
  readonly cfg: ShuntConfig;
  readonly sessionID: Session.ID;
}

const shuntDecisionFor = (ctx: ShuntDecisionContext) =>
  decideShunt(
    {
      resolvedPath: ctx.resolved ?? ctx.readInput.path,
      insideRoot: ctx.resolved !== undefined,
      controlPlane:
        ctx.resolved === undefined
          ? true
          : isControlPlanePath(ctx.readInput.path, ctx.resolved, ctx.root),
      sliced: ctx.readInput.offset !== undefined || ctx.readInput.limit !== undefined,
      mediaOrDirectory: ctx.shape.kind !== "text",
      lines: ctx.shape.lines,
      bytes: Math.max(ctx.shape.rawBytes, ctx.diskSize),
      minLines: ctx.cfg.minLines,
      minBytes: ctx.cfg.minBytes,
    },
    memoryOf(ctx.sessionID),
  );

const commitSummaryState = (sessionID: Session.ID, resolved: string): boolean => {
  const latest = memoryOf(sessionID);
  const current = latest.shunted?.get(resolved)?.kind;
  if (current === "edited" || current === "verbatim-unlocked") return false;
  const shunted = new Map(latest.shunted);
  shunted.set(resolved, { kind: "summarized" });
  remember(sessionID, { ...latest, shunted });
  return true;
};

const finishSummary = (
  event: Extract<ToolAfter, { readonly status: "completed" }>,
  resolved: string,
  health: Health,
  attempt: SummarizedAttempt,
): Effect.Effect<ShuntTelemetryEvent | undefined> =>
  Effect.gen(function* () {
    if (!commitSummaryState(event.sessionID, resolved)) return undefined;
    if (attempt.legendXml !== undefined && health.kind === "ready") {
      const xml = attempt.legendXml;
      yield* Effect.promise(() => recordLegendSeen(health.binary, event.sessionID, xml)).pipe(
        Effect.catchCause(() => Effect.void),
      );
    }
    mutateReadResult(event.result, attempt);
    return {
      bytesRaw: attempt.rawBytes,
      bytesServed: attempt.servedBytes,
      summarized: true,
      escalation: false,
    };
  });

const shuntReadAfter = (
  root: string,
  event: Extract<ToolAfter, { readonly status: "completed" }>,
  health: Health,
): Effect.Effect<ShuntTelemetryEvent | undefined> =>
  Effect.gen(function* () {
    if (event.codemode === true) return undefined;
    const readInput = decodeReadInput(event.input);
    if (readInput === undefined) return undefined;
    const resolved = scope(root, readInput.path);
    const shape = inspectReadResult(event.result);
    const disk = yield* maybeStatDisk(resolved, readInput, root, shape);
    const cfg = readShuntConfig();
    const { verdict, next } = shuntDecisionFor({
      readInput,
      resolved,
      root,
      shape,
      diskSize: disk?.size ?? 0,
      cfg,
      sessionID: event.sessionID,
    });
    if (verdict.kind === "bypass") {
      if (!verdict.escalation) return undefined;
      remember(event.sessionID, next);
      return { bytesRaw: 0, bytesServed: shape.rawBytes, summarized: false, escalation: true };
    }
    if (resolved === undefined) return undefined;
    const source = yield* Effect.promise(() =>
      resolveSummarySource({ resolved, shape, health, cfg, disk }),
    );
    if (source === undefined) return undefined;
    const attempt = yield* Effect.promise(() =>
      summarizeFile({
        root,
        resolvedPath: resolved,
        displayPath: readInput.path,
        ...source,
        health,
        legendSeenFile: legendSeenFile(event.sessionID),
      }),
    );
    if (attempt.kind === "fail-open") return undefined;
    return yield* finishSummary(event, resolved, health, attempt);
  });

export const shuntAfter = (
  ctx: Plugin.Context,
  event: ToolAfter,
  health: Health,
  root?: string,
): Effect.Effect<ShuntTelemetryEvent | undefined> =>
  Effect.gen(function* () {
    if (event.status !== "completed") return undefined;
    if (event.tool === "edit" || event.tool === "write") {
      const dir = root ?? (yield* rootOf(ctx, event.sessionID));
      return shuntMutateAfter(dir, event);
    }
    if (event.tool === "read") {
      const dir = root ?? (yield* rootOf(ctx, event.sessionID));
      return yield* shuntReadAfter(dir, event, health);
    }
    return undefined;
  }).pipe(Effect.catchCause(() => Effect.succeed(undefined)));

export const attachGuard = (
  ctx: Plugin.Context,
  read?: AskReader,
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    yield* ctx.tool.hook("execute.before", (event) => guardBefore(ctx, event, read));
    yield* Effect.logInfo("Registered search guard", { trigger: "tool.execute.before" });
  });

/**
 * The request catalogue. The rule the part carries is `contextRule(health)`,
 * while unmeasured code-edit reminders sync through durable instruction entries
 * so `event.system` stays identical across edits. A defect is logged, never
 * thrown: the request is the model's next turn, and a broken shape must not
 * lose it.
 */
export const attachCatalogue = (ctx: Plugin.Context): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    yield* ctx.session.hook("context", (event) =>
      Effect.gen(function* () {
        if (!isSpectre(event.agent)) return;

        const ask = contextAsk(event);
        if (ask === undefined) return shape(event);

        const health = yield* Effect.promise(() => probe()).pipe(
          Effect.catchCause(() => Effect.succeed(undefined)),
        );
        if (health === undefined) return shape(event);

        const decision = decide(ask, memoryOf(event.sessionID), envOf(health));
        const { verdict } = decision;
        shape(event, { ...CONTRACT, rule: contextRule(health) });
        remember(event.sessionID, decision.next);
        yield* syncEndOfWork(
          ctx,
          event.sessionID,
          health.kind === "ready" && verdict.kind === "prose" && verdict.key === "end-of-work",
        );
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("search context failed", { cause }).pipe(Effect.asVoid),
        ),
      ),
    );

    yield* Effect.logInfo("Registered search context", { trigger: "session.context" });
  });
