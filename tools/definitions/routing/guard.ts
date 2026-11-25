import { type Model, type Plugin, Tool } from "@opencode/plugin/effect";
import { Effect } from "effect";
import { agentIds } from "../../../agents";
import { known } from "./catalogue";
import {
  advanceDrift,
  classifyShellMechanical,
  DELEGATION_KEY,
  type DriftSignal,
  emptyDriftState,
  type MutableContextMessage,
  shapeEscalationMessages,
  type TurnDriftState,
} from "./delegation";
import { hostCatalogue } from "./host";
import { load } from "./load";

export const SUBAGENT_MODEL_DESCRIPTION =
  "Pass the exact model.ref returned by tools.spectre.routing in execute on new spawns. Omit model when resuming an existing sessionID unless switching models deliberately.";

const isResumeInput = (sessionID: unknown): boolean =>
  typeof sessionID === "string"
    ? sessionID.trim() !== ""
    : sessionID !== undefined && sessionID !== null;

const matchesAllowedEntry = (rawModel: string, allowedEntry: string): boolean => {
  const hash = allowedEntry.indexOf("#");
  if (hash !== -1) return rawModel === allowedEntry;
  return rawModel.split("#")[0] === allowedEntry;
};

const anySpendableInCatalogue = (
  allowedModels: ReadonlyArray<string>,
  models: ReadonlyArray<Model.Info>,
): boolean => {
  const catalogue = models.map(known);
  return allowedModels.some((entry) => {
    const [base, variant] = entry.split("#", 2);
    const hit = catalogue.find((row) => `${row.providerID}/${row.id}` === base);
    if (hit === undefined || !hit.enabled || hit.status === "deprecated" || !hit.tools) {
      return false;
    }
    return variant === undefined || hit.rungs.includes(variant);
  });
};

const listSpendableCheck = (
  ctx: Plugin.Context,
  allowedModels: ReadonlyArray<string>,
): Effect.Effect<boolean> => {
  if (typeof ctx.model?.list !== "function") return Effect.succeed(true);
  return hostCatalogue(ctx).pipe(
    Effect.map((listed) =>
      listed.problem !== undefined ? true : anySpendableInCatalogue(allowedModels, listed.models),
    ),
  );
};

const checkSubagentModel = (
  ctx: Plugin.Context,
  event: {
    readonly tool: string;
    readonly agent: string;
    readonly sessionID: Parameters<Plugin.Context["session"]["get"]>[0]["sessionID"];
    readonly input: unknown;
  },
) =>
  Effect.gen(function* () {
    if (event.tool !== "subagent") return;
    if (!agentIds.some((id) => id === event.agent)) return;
    if (typeof event.input !== "object" || event.input === null || Array.isArray(event.input)) {
      return;
    }
    const input = event.input as { sessionID?: unknown; model?: unknown };
    if (isResumeInput(input.sessionID)) return;
    if (typeof input.model !== "string") return;
    const rawModel = input.model.trim();
    if (rawModel === "") return;

    const session =
      typeof ctx.session?.get === "function"
        ? yield* ctx.session
            .get({ sessionID: event.sessionID })
            .pipe(Effect.catch(() => Effect.succeed(undefined)))
        : undefined;
    const directory = session?.location.directory ?? ctx.location.directory;
    const configured = yield* load(directory);
    const allowedModels = Object.values(configured.tables.models);
    if (
      configured.tables.setup !== undefined ||
      configured.problems.length > 0 ||
      allowedModels.length === 0
    ) {
      return;
    }

    if (allowedModels.some((entry) => matchesAllowedEntry(rawModel, entry))) return;

    const hasSpendable = yield* listSpendableCheck(ctx, allowedModels);
    if (!hasSpendable) return;

    yield* Effect.fail(
      new Tool.Error({
        message: `Model "${rawModel}" is not in spectre.json models allowlist (${allowedModels.join(", ")}). Call tools.spectre.routing in execute and pass profile.model.ref.`,
      }),
    );
  });

const MAX_SESSION_CACHE = 256;

interface CachedSession {
  readonly isRoot: boolean;
  readonly directory: string;
}

const setBounded = <V>(map: Map<string, V>, key: string, value: V): void => {
  if (!map.has(key) && map.size >= MAX_SESSION_CACHE) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
  map.set(key, value);
};

const readStringField = (input: unknown, keys: ReadonlyArray<string>): string | undefined => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return undefined;
  const record = input as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return undefined;
};

const classifyToolAfter = (tool: string, input: unknown): DriftSignal | undefined => {
  if (tool === "subagent") return { kind: "subagent-called" };
  if (tool === "read") {
    const path = readStringField(input, ["path", "filePath"]);
    return path === undefined ? undefined : { kind: "read-code", path };
  }
  if (tool === "edit" || tool === "write") {
    const path = readStringField(input, ["path", "filePath"]);
    return path === undefined ? undefined : { kind: "mutate-file", path };
  }
  if (tool === "shell") {
    const command = readStringField(input, ["command"]);
    return command !== undefined && classifyShellMechanical(command)
      ? { kind: "shell-mechanical" }
      : undefined;
  }
  return undefined;
};

const resolveSessionScope = (
  ctx: Plugin.Context,
  sessionCache: Map<string, CachedSession>,
  sessionID: Parameters<Plugin.Context["session"]["get"]>[0]["sessionID"],
): Effect.Effect<CachedSession | undefined> =>
  Effect.gen(function* () {
    const existing = sessionCache.get(sessionID);
    if (existing !== undefined) return existing;
    if (typeof ctx.session?.get !== "function") return undefined;
    const session = yield* ctx.session
      .get({ sessionID })
      .pipe(Effect.catch(() => Effect.succeed(undefined)));
    if (session === undefined) return undefined;
    const cached: CachedSession = {
      isRoot: session.parentID === undefined,
      directory: session.location?.directory ?? ctx.location.directory,
    };
    setBounded(sessionCache, sessionID, cached);
    return cached;
  });

const applyContextHook = (event: {
  readonly agent: string;
  readonly tools: Record<string, { readonly input: unknown }>;
  readonly messages?: ReadonlyArray<MutableContextMessage>;
}): void => {
  if (event.agent !== "spectre") return;
  const subagent = event.tools.subagent;
  const input =
    subagent !== undefined && typeof subagent.input === "object" && subagent.input !== null
      ? (subagent.input as { properties?: { model?: { description?: string } } })
      : undefined;
  if (input?.properties?.model !== undefined) {
    input.properties.model.description = SUBAGENT_MODEL_DESCRIPTION;
  }
  shapeEscalationMessages(event.messages);
};

const resetSessionDrift = (
  ctx: Plugin.Context,
  driftStates: Map<string, TurnDriftState>,
  sessionID: Parameters<Plugin.Context["session"]["get"]>[0]["sessionID"],
): Effect.Effect<void> => {
  const prev = driftStates.get(sessionID);
  if (prev === undefined) return Effect.void;
  const { state, verdict } = advanceDrift(prev, { kind: "prompt-reset" });
  setBounded(driftStates, sessionID, state);
  const remove = ctx.session?.instructions?.entry?.remove;
  if (verdict.action !== "clear" || typeof remove !== "function") return Effect.void;
  return remove({ sessionID, key: DELEGATION_KEY }).pipe(Effect.catch(() => Effect.void));
};

const syncDriftAfterTool = (
  ctx: Plugin.Context,
  driftStates: Map<string, TurnDriftState>,
  sessionCache: Map<string, CachedSession>,
  event: {
    readonly tool: string;
    readonly agent: string;
    readonly status: "completed" | "error";
    readonly sessionID: Parameters<Plugin.Context["session"]["get"]>[0]["sessionID"];
    readonly input: unknown;
  },
): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (event.agent !== "spectre" || event.status !== "completed") return;
    const entry = ctx.session?.instructions?.entry;
    if (typeof entry?.put !== "function") return;
    const signal = classifyToolAfter(event.tool, event.input);
    if (signal === undefined) return;
    const cached = yield* resolveSessionScope(ctx, sessionCache, event.sessionID);
    if (cached === undefined || !cached.isRoot) return;

    const prev = driftStates.get(event.sessionID) ?? emptyDriftState();
    const { state, verdict } = advanceDrift(prev, signal);
    setBounded(driftStates, event.sessionID, state);

    if (verdict.action === "put") {
      const configured = yield* load(cached.directory);
      if (configured.tables.setup !== undefined) return;
      yield* entry
        .put({ sessionID: event.sessionID, key: DELEGATION_KEY, value: verdict.text })
        .pipe(Effect.catch(() => Effect.void));
      return;
    }
    if (verdict.action === "clear" && typeof entry.remove === "function") {
      yield* entry
        .remove({ sessionID: event.sessionID, key: DELEGATION_KEY })
        .pipe(Effect.catch(() => Effect.void));
    }
  });

export const attachRoutingGuard = (ctx: Plugin.Context) =>
  Effect.gen(function* () {
    const driftStates = new Map<string, TurnDriftState>();
    const sessionCache = new Map<string, CachedSession>();

    if (typeof ctx.session?.hook === "function") {
      yield* ctx.session.hook("context", (event) => {
        applyContextHook(event as Parameters<typeof applyContextHook>[0]);
        return Effect.void;
      });
      yield* ctx.session.hook("prompt", (event) =>
        resetSessionDrift(ctx, driftStates, event.sessionID),
      );
    }

    if (typeof ctx.tool?.hook === "function") {
      yield* ctx.tool.hook("execute.before", (event) => checkSubagentModel(ctx, event));
      yield* ctx.tool.hook("execute.after", (event) =>
        syncDriftAfterTool(ctx, driftStates, sessionCache, event),
      );
    }
  });
