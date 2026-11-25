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
import type { Known } from "./types";

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

const CROSS_FAMILY_REVIEW_RE =
  /\b(crosscheck|cross-check|second opinion|interrogate|adversarial review)\b/i;

const YUBIKEY_OTP_RE = /^c{2,12}[cbdefghijklnrtuv]{10,60}$/i;

export const YUBIKEY_OTP_NOTE =
  "[spectre:yubikey-otp-ignored] Accidental YubiKey OTP input detected; reply with 'Ignored accidental YubiKey touch.' and take no action.";

const findSpendableKnown = (
  catalogue: ReadonlyArray<Known>,
  modelRef: string,
): Known | undefined => {
  const [base, variant] = modelRef.split("#", 2);
  const hit = catalogue.find((row) => `${row.providerID}/${row.id}` === base);
  if (hit === undefined || !hit.enabled || hit.status === "deprecated" || !hit.tools) {
    return undefined;
  }
  return variant === undefined || hit.rungs.includes(variant) ? hit : undefined;
};

const anySpendableInCatalogue = (
  allowedModels: ReadonlyArray<string>,
  models: ReadonlyArray<Model.Info>,
): boolean => {
  const catalogue = models.map(known);
  return allowedModels.some((entry) => findSpendableKnown(catalogue, entry) !== undefined);
};

const pickDifferentFamilyModel = (
  modelsTable: Readonly<Record<string, string>>,
  crosscheckOrder: ReadonlyArray<string> | undefined,
  catalogue: ReadonlyArray<Known>,
  parentFamily: string,
): { readonly alias: string; readonly entry: string; readonly family: string } | undefined => {
  const spendable: Array<{ readonly alias: string; readonly entry: string; readonly family: string }> =
    [];
  for (const [alias, entry] of Object.entries(modelsTable)) {
    const found = findSpendableKnown(catalogue, entry);
    if (found?.family !== undefined) {
      spendable.push({ alias, entry, family: found.family });
    }
  }
  if (new Set(spendable.map((one) => one.family)).size < 2) return undefined;

  for (const alias of crosscheckOrder ?? []) {
    const match = spendable.find((one) => one.alias === alias && one.family !== parentFamily);
    if (match !== undefined) return match;
  }
  return spendable.find((one) => one.family !== parentFamily);
};

const checkCrossFamilyReview = (
  ctx: Plugin.Context,
  args: {
    readonly agent: string;
    readonly description: unknown;
    readonly rawModel: string;
    readonly parentModel: { readonly providerID: string; readonly id: string } | undefined;
    readonly modelsTable: Readonly<Record<string, string>>;
    readonly crosscheckOrder: ReadonlyArray<string> | undefined;
  },
): Effect.Effect<void, Tool.Error> =>
  Effect.gen(function* () {
    if (args.agent !== "spectre" || args.parentModel === undefined) return;
    if (typeof args.description !== "string" || !CROSS_FAMILY_REVIEW_RE.test(args.description)) {
      return;
    }
    if (typeof ctx.model?.list !== "function") return;
    const listed = yield* hostCatalogue(ctx);
    if (listed.problem !== undefined) return;

    const catalogue = listed.models.map(known);
    const parentRef = `${args.parentModel.providerID}/${args.parentModel.id}`;
    const parentFamily = findSpendableKnown(catalogue, parentRef)?.family;
    const childFamily = findSpendableKnown(catalogue, args.rawModel)?.family;
    if (parentFamily === undefined || childFamily === undefined || childFamily !== parentFamily) {
      return;
    }

    const alt = pickDifferentFamilyModel(
      args.modelsTable,
      args.crosscheckOrder,
      catalogue,
      parentFamily,
    );
    if (alt === undefined) return;

    yield* Effect.fail(
      new Tool.Error({
        message: `Cross-family review required: "${args.rawModel}" shares family "${childFamily}" with the active session model. Use a different-family crosscheck model from spectre.json such as "${alt.entry}" (alias "${alt.alias}", family "${alt.family}").`,
      }),
    );
  });

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
    const input = event.input as { sessionID?: unknown; model?: unknown; description?: unknown };
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

    if (allowedModels.some((entry) => matchesAllowedEntry(rawModel, entry))) {
      yield* checkCrossFamilyReview(ctx, {
        agent: event.agent,
        description: input.description,
        rawModel,
        parentModel: session?.model,
        modelsTable: configured.tables.models,
        crosscheckOrder: configured.tables.crosscheck,
      });
      return;
    }

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
  if (tool === "ripgrep" || tool === "glob") {
    const pattern = readStringField(input, ["pattern"]) ?? "";
    const scope = readStringField(input, ["path", "include"]) ?? ".";
    return { kind: "read-code", path: `${tool}:${scope}:${pattern}` };
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

interface PromptFilterEvent {
  prompt?: { text?: unknown };
  text?: unknown;
  delivery?: unknown;
}

const setQueueDelivery = (event: PromptFilterEvent): void => {
  const descriptor = Object.getOwnPropertyDescriptor(event, "delivery");
  if (descriptor === undefined || descriptor.writable) {
    event.delivery = "queue";
  }
};

const filterYubiKeyOtpPrompt = (event: PromptFilterEvent): boolean => {
  const raw =
    typeof event.prompt?.text === "string"
      ? event.prompt.text
      : typeof event.text === "string"
        ? event.text
        : undefined;
  if (raw === undefined || !YUBIKEY_OTP_RE.test(raw.trim())) return false;
  if (event.prompt !== undefined && typeof event.prompt.text === "string") {
    event.prompt.text = YUBIKEY_OTP_NOTE;
  } else {
    event.text = YUBIKEY_OTP_NOTE;
  }
  setQueueDelivery(event);
  return true;
};

export const attachRoutingGuard = (ctx: Plugin.Context) =>
  Effect.gen(function* () {
    const driftStates = new Map<string, TurnDriftState>();
    const sessionCache = new Map<string, CachedSession>();

    if (typeof ctx.session?.hook === "function") {
      yield* ctx.session.hook("context", (event) => {
        applyContextHook(event as Parameters<typeof applyContextHook>[0]);
        return Effect.void;
      });
      yield* ctx.session.hook("prompt", (event) => {
        if (filterYubiKeyOtpPrompt(event as unknown as PromptFilterEvent)) return Effect.void;
        return resetSessionDrift(ctx, driftStates, event.sessionID);
      });
    }

    if (typeof ctx.tool?.hook === "function") {
      yield* ctx.tool.hook("execute.before", (event) => checkSubagentModel(ctx, event));
      yield* ctx.tool.hook("execute.after", (event) =>
        syncDriftAfterTool(ctx, driftStates, sessionCache, event),
      );
    }
  });
