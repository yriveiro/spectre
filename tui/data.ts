import type { SessionInfo } from "@opencode/client";
import { Model as ModelSchema } from "@opencode/plugin/effect";
import type { Route } from "@opencode/plugin/tui/context";
import { Effect, Option, Schema } from "effect";
import {
  candidates,
  clampEffort,
  crosscheckOf,
  DEFAULT_AGENT,
  DEFAULT_PROFILES,
  inheritedConfigPath,
  isDefaultProfile,
  JEV_MODEL,
  type JudgeConfig,
  type Known,
  known,
  ladder,
  loadProject,
  modelNames,
  priorityOf,
  proposeAlias,
  resolveProfile,
  type Pick as Spent,
  serialise,
  writeConfig,
  writePath,
} from "../tools/definitions/routing/index.ts";

export { DEFAULT_PROFILES, isDefaultProfile };

export type Model = Known;

export type Profile = {
  readonly name: string;
  readonly effort: string | undefined;
  readonly match: string | undefined;
  readonly why: string | undefined;
  readonly crosscheck:
    | {
        readonly effort: string | undefined;
        /** The alias the profile pins the second opinion to, or `undefined` for the list. */
        readonly pinned: string | undefined;
      }
    | undefined;
  readonly agent: string;
  readonly pinned: string | undefined;
  readonly enabled?: boolean | undefined;
};

export type Draft = {
  /** The directory this draft was read from. A session move makes it stale. */
  readonly directory: string;
  /** The file the draft was read from, or `undefined` when there is none. */
  readonly source: string | undefined;
  /** What the reader found wrong with the file, one line per problem. */
  readonly problems: ReadonlyArray<string>;
  readonly provider: string | undefined;
  readonly models: ReadonlyArray<{
    readonly alias: string;
    readonly ref: string;
    readonly priority: number;
  }>;
  /** The models that may serve a crosscheck, in fallback order. */
  readonly crosscheck: ReadonlyArray<string>;
  readonly profiles: ReadonlyArray<Profile>;
  readonly judge?: JudgeConfig | undefined;
};

export const isProfileEnabled = (profile: Profile): boolean => profile.enabled !== false;

export const isCustomProfile = (profile: Profile): boolean => !isDefaultProfile(profile.name);

export const configuredProfiles = (draft: Draft): ReadonlyArray<Profile> =>
  draft.profiles.filter(isProfileEnabled);

export const defaultProfiles = (enabled = true): ReadonlyArray<Profile> =>
  Object.entries(DEFAULT_PROFILES).map(([name, entry]) => ({
    name,
    effort: entry.effort,
    match: entry.match,
    why: entry.why,
    crosscheck:
      entry.crosscheck === undefined
        ? undefined
        : { effort: entry.crosscheck.effort, pinned: undefined },
    agent: entry.agent ?? DEFAULT_AGENT,
    pinned: undefined,
    enabled,
  }));

export const clampModelEffort = (model: Model, effort: string | undefined): string =>
  clampEffort(ladder(model), effort) ?? "none";

export const sessionDefaultDraft = (draft: Draft, sessionModel: Model | undefined): Draft => {
  if (
    draft.source !== undefined ||
    draft.problems.length > 0 ||
    draft.models.length > 0 ||
    sessionModel === undefined ||
    !sessionModel.enabled ||
    sessionModel.status === "deprecated" ||
    !sessionModel.tools
  ) {
    return draft;
  }
  const alias = proposeAlias(sessionModel, []);
  const ref = `${sessionModel.providerID}/${sessionModel.id}`;
  return {
    ...draft,
    provider: draft.provider ?? sessionModel.providerID,
    models: [{ alias, ref, priority: 1 }],
    crosscheck: [],
    profiles: draft.profiles.map((profile) => ({
      ...profile,
      effort: clampModelEffort(sessionModel, profile.effort),
      crosscheck: undefined,
    })),
  };
};

export type SelectionMethod =
  | { readonly kind: "jev"; readonly badge: "JEV"; readonly model: string }
  | { readonly kind: "lexical"; readonly badge: "Lexical" }
  | { readonly kind: "session"; readonly badge: "Session"; readonly model: string | undefined };

export const selectionMethodOf = (input: {
  readonly draft: Draft;
  readonly jevAvailable: boolean;
  readonly sessionModel?: string | undefined;
}): SelectionMethod => {
  if (input.draft.judge?.kind === "lexical") {
    return { kind: "lexical", badge: "Lexical" };
  }
  if (input.jevAvailable && input.draft.judge !== undefined) {
    return { kind: "jev", badge: "JEV", model: input.draft.judge.model ?? JEV_MODEL };
  }
  return { kind: "session", badge: "Session", model: input.sessionModel };
};

export type Resolution = {
  readonly profile: string;
  readonly alias: string | undefined;
  readonly ref: string | undefined;
  readonly rung: string | undefined;
  readonly cost: string | undefined;
  readonly crosscheck: string | undefined;
  readonly crosscheckCost: string | undefined;
  /** Why a configured crosscheck found no model. Absent when none was asked for. */
  readonly crosscheckProblem: string | undefined;
  readonly problem: string | undefined;
};

export const EFFORT_DOT_LEVELS = 4;

const EFFORT_DOT_FILL: Readonly<Record<string, number>> = {
  none: 0,
  minimal: 1,
  low: 1,
  medium: 2,
  high: 3,
  xhigh: 3,
  max: 4,
};

export const effortDots = (rung: string | undefined): string => {
  const filled = rung === undefined ? 0 : (EFFORT_DOT_FILL[rung] ?? 0);
  return "●".repeat(filled) + "○".repeat(Math.max(0, EFFORT_DOT_LEVELS - filled));
};

export const formatCost = (costInput: number, costOutput: number): string =>
  `$${costInput}/$${costOutput}`;

export const normalizeCost = (cost: string | undefined): string | undefined => {
  if (cost === undefined) return undefined;
  const nums = [...cost.matchAll(/\$(\d+(?:\.\d+)?)/g)].map((match) => match[1]);
  if (nums.length >= 2 && nums[0] !== undefined && nums[1] !== undefined) {
    return `$${nums[0]}/$${nums[1]}`;
  }
  return cost;
};

export const spendRef = (one: Spent): string =>
  one.rung === undefined || one.ref.includes("#") ? one.ref : `${one.ref}#${one.rung}`;

/** The part of a session the page reads: where the session is. */
export type SessionAt = Pick<SessionInfo, "location">;

/**
 * The directory the config is read from: the one the session is in.
 *
 * The named session wins, then the session the route points at, then the
 * location this TUI opened in. A session carries its own location and a move
 * updates it, so this answers the new worktree on the render after the move.
 */
export const directoryOf = (input: {
  readonly sessionID?: string | undefined;
  readonly session: (sessionID: string) => SessionAt | undefined;
  readonly route: Route;
  readonly location: { readonly directory?: string | undefined } | undefined;
  readonly fallback: string;
}): string => {
  const named =
    input.sessionID === undefined ? undefined : input.session(input.sessionID)?.location.directory;
  if (named !== undefined) return named;
  const routed =
    input.route.type === "session"
      ? input.session(input.route.sessionID)?.location.directory
      : undefined;
  return routed ?? input.location?.directory ?? input.fallback;
};

export const read = async (directory: string): Promise<Draft> => {
  // The path is read separately because a file that does not decode contributes
  // no source, and the page still has to name the file it could not read.
  const source = await Effect.runPromise(inheritedConfigPath(directory)).catch(() => undefined);
  const found = await Effect.runPromise(loadProject(directory));
  const ordered = priorityOf(found.tables.models, found.tables.priority);
  const models = ordered.ranked.map((one) => ({
    alias: one.alias,
    ref: one.ref,
    priority: one.priority,
  }));
  const crosscheck = crosscheckOf(
    found.tables.models,
    found.tables.crosscheck,
    models.map((one) => one.alias),
  );
  const held = new Set(models.map((one) => one.alias));

  if (!found.configuredProfiles) {
    return {
      directory,
      source,
      problems: [...found.problems, ...ordered.problems, ...crosscheck.problems],
      provider: found.tables.provider,
      judge: found.tables.judge,
      models,
      crosscheck: crosscheck.listed,
      profiles: defaultProfiles(true),
    };
  }

  const fromFile = Object.entries(found.tables.profiles).map(([name, entry]): Profile => {
    const named = modelNames(entry.model);
    const crossNamed = modelNames(entry.crosscheck?.model);
    return {
      name,
      effort: entry.effort,
      match: entry.match,
      why: entry.why,
      crosscheck:
        entry.crosscheck === undefined
          ? undefined
          : {
              effort: entry.crosscheck.effort,
              pinned: crossNamed.find((one) => held.has(one)) ?? crossNamed[0],
            },
      agent: entry.agent ?? DEFAULT_AGENT,
      pinned: named.find((one) => held.has(one)) ?? named[0],
      enabled: true,
    };
  });
  const configuredNames = new Set(fromFile.map((one) => one.name));
  const disabledDefaults = defaultProfiles(false).filter((one) => !configuredNames.has(one.name));

  return {
    directory,
    source,
    problems: [...found.problems, ...ordered.problems, ...crosscheck.problems],
    provider: found.tables.provider,
    judge: found.tables.judge,
    models,
    crosscheck: crosscheck.listed,
    profiles: [...fromFile, ...disabledDefaults],
  };
};

const decodeInfo = Schema.decodeUnknownOption(ModelSchema.Info);

export const catalogue = (models: ReadonlyArray<unknown>): ReadonlyArray<Model> =>
  models.flatMap((info) =>
    Option.match(decodeInfo(info), {
      onNone: () => [],
      onSome: (decoded) => [known(decoded)],
    }),
  );

export const resolve = (draft: Draft, models: ReadonlyArray<Model>): ReadonlyArray<Resolution> => {
  const kept = candidates(
    draft.models.map((one) => ({ alias: one.alias, ref: one.ref, pinned: undefined })),
    models,
  );

  return configuredProfiles(draft).map((profile): Resolution => {
    const found = resolveProfile(
      profile.name,
      {
        effort: profile.effort,
        model: profile.pinned === undefined ? undefined : [profile.pinned],
        crosscheck:
          profile.crosscheck === undefined
            ? undefined
            : {
                effort: profile.crosscheck.effort,
                model:
                  profile.crosscheck.pinned === undefined ? undefined : [profile.crosscheck.pinned],
              },
        match: profile.match,
        why: profile.why,
        agent: profile.agent,
      },
      kept.kept,
      DEFAULT_AGENT,
      draft.crosscheck,
    );

    if (found.resolution === undefined)
      return {
        profile: profile.name,
        alias: undefined,
        ref: undefined,
        rung: undefined,
        cost: undefined,
        crosscheck: undefined,
        crosscheckCost: undefined,
        crosscheckProblem: undefined,
        problem: found.problem,
      };

    const primary = found.resolution.primary;
    const crosscheck = found.resolution.crosscheck;
    return {
      profile: profile.name,
      alias: primary.alias,
      ref: spendRef(primary),
      rung: primary.rung,
      cost: formatCost(primary.costInput, primary.costOutput),
      crosscheck: crosscheck === undefined ? undefined : spendRef(crosscheck),
      crosscheckCost:
        crosscheck === undefined
          ? undefined
          : formatCost(crosscheck.costInput, crosscheck.costOutput),
      crosscheckProblem: found.resolution.crosscheckProblem,
      problem: undefined,
    };
  });
};

const preserved = async (path: string): Promise<Record<string, unknown>> => {
  const file = Bun.file(path);
  if (!(await file.exists())) return {};
  try {
    const raw: unknown = Bun.JSONC.parse(await file.text());
    return typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
};

const written = (draft: Draft): Parameters<typeof writeConfig>[1] => ({
  provider: draft.provider,
  judge: draft.judge,
  models: Object.fromEntries(draft.models.map((one) => [one.alias, one.ref])),
  priority: draft.models.map((one) => one.alias),
  crosscheck: [...draft.crosscheck],
  profiles: Object.fromEntries(
    configuredProfiles(draft).map((one) => [
      one.name,
      {
        effort: one.effort,
        model: one.pinned,
        crosscheck:
          one.crosscheck === undefined
            ? undefined
            : {
                effort: one.crosscheck.effort,
                model: one.crosscheck.pinned,
              },
        match: one.match,
        why: one.why,
        agent: one.agent === DEFAULT_AGENT ? undefined : one.agent,
      },
    ]),
  ),
});

export const formatConfig = (draft: Draft): string => serialise(written(draft)).trimEnd();

export const save = async (draft: Draft): Promise<string> => {
  const path = await Effect.runPromise(writePath(draft.directory));
  const kept = await preserved(draft.source ?? path);
  const rest = { ...kept };
  delete rest.setup;
  delete rest.judge;
  const file = { ...rest, ...written(draft) } as Parameters<typeof writeConfig>[1];
  await Effect.runPromise(writeConfig(path, file));
  return path;
};
