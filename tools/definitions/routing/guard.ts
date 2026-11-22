import { type Model, type Plugin, Tool } from "@opencode/plugin/effect";
import { Effect } from "effect";
import { agentIds } from "../../../agents";
import { known } from "./catalogue";
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

export const attachRoutingGuard = (ctx: Plugin.Context) =>
  Effect.gen(function* () {
    if (typeof ctx.session?.hook === "function") {
      yield* ctx.session.hook("context", (event) => {
        const subagent = event.agent === "spectre" ? event.tools.subagent : undefined;
        const input =
          subagent !== undefined && typeof subagent.input === "object" && subagent.input !== null
            ? (subagent.input as { properties?: { model?: { description?: string } } })
            : undefined;
        if (input?.properties?.model !== undefined) {
          input.properties.model.description = SUBAGENT_MODEL_DESCRIPTION;
        }
        return Effect.void;
      });
    }

    if (typeof ctx.tool?.hook === "function") {
      yield* ctx.tool.hook("execute.before", (event) => checkSubagentModel(ctx, event));
    }
  });
