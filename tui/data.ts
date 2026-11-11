import type { ModelInfo, SessionInfo } from "@opencode/client";
import type { Route } from "@opencode/plugin/tui/context";
import type { Model as Schema } from "@opencode/schema/model";
import { Effect } from "effect";
import {
  candidates,
  DEFAULT_AGENT,
  DEFAULT_PROFILES,
  FILE_NAME,
  isDefaultProfile,
  type JudgeConfig,
  KNOWN_ORDER,
  known,
  loadProject,
  type ProfileEntry,
  priorityOf,
  projectPath,
  resolveProfile,
  type Pick as Spent,
  serialise,
  writeConfig,
} from "../tools/definitions/routing/index.ts";

export { DEFAULT_PROFILES, isDefaultProfile };

export type Model = {
  readonly providerID: string;
  readonly id: string;
  readonly name: string;
  readonly family: string | undefined;
  readonly rungs: ReadonlyArray<string>;
  readonly costInput: number;
  readonly costOutput: number;
  readonly enabled: boolean;
  readonly deprecated: boolean;
  readonly tools: boolean;
};

export type Profile = {
  readonly name: string;
  readonly effort: string | undefined;
  readonly match: string | undefined;
  readonly why: string | undefined;
  readonly crosscheck: { readonly effort: string | undefined } | undefined;
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
    crosscheck: entry.crosscheck === undefined ? undefined : { effort: entry.crosscheck.effort },
    agent: entry.agent ?? DEFAULT_AGENT,
    pinned: undefined,
    enabled,
  }));

export type Resolution = {
  readonly profile: string;
  readonly alias: string | undefined;
  readonly ref: string | undefined;
  readonly rung: string | undefined;
  readonly cost: string | undefined;
  readonly crosscheck: string | undefined;
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

const spendRef = (one: Spent): string =>
  one.rung === undefined || one.ref.includes("#") ? one.ref : `${one.ref}#${one.rung}`;

const pins = (model: ProfileEntry["model"]): ReadonlyArray<string> => {
  if (model === undefined) return [];
  return typeof model === "string" ? [model] : model;
};

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
  const source = await Effect.runPromise(projectPath(directory)).catch(() => undefined);
  const found = await Effect.runPromise(loadProject(directory));
  const ordered = priorityOf(found.tables.models, found.tables.priority);
  const models = ordered.ranked.map((one) => ({
    alias: one.alias,
    ref: one.ref,
    priority: one.priority,
  }));
  const held = new Set(models.map((one) => one.alias));

  if (!found.configuredProfiles) {
    return {
      directory,
      source,
      problems: [...found.problems, ...ordered.problems],
      provider: found.tables.provider,
      judge: found.tables.judge,
      models,
      profiles: defaultProfiles(true),
    };
  }

  const fromFile = Object.entries(found.tables.profiles).map(([name, entry]): Profile => {
    const named = pins(entry.model);
    return {
      name,
      effort: entry.effort,
      match: entry.match,
      why: entry.why,
      crosscheck: entry.crosscheck === undefined ? undefined : { effort: entry.crosscheck.effort },
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
    problems: [...found.problems, ...ordered.problems],
    provider: found.tables.provider,
    judge: found.tables.judge,
    models,
    profiles: [...fromFile, ...disabledDefaults],
  };
};

type Row = Model & {
  readonly status?: string;
  readonly tools?: boolean;
};

export const catalogue = (models: ReadonlyArray<ModelInfo>): ReadonlyArray<Model> => {
  const rows: Array<Row> = [];
  for (const info of models) {
    const one = known(info as unknown as Schema.Info);
    rows.push({ ...one, deprecated: one.status === "deprecated" });
  }
  return rows;
};

const info = (one: Model): Schema.Info => {
  const row = one as Row;
  return {
    providerID: one.providerID,
    id: one.id,
    name: one.name,
    family: one.family,
    variants: one.rungs.map((id) => ({ id })),
    cost: [{ input: one.costInput, output: one.costOutput }],
    enabled: one.enabled,
    status: one.deprecated ? "deprecated" : (row.status ?? "active"),
    capabilities: { tools: row.tools ?? true },
  } as unknown as Schema.Info;
};

export const resolve = (draft: Draft, models: ReadonlyArray<Model>): ReadonlyArray<Resolution> => {
  const kept = candidates(
    draft.models.map((one) => ({ alias: one.alias, ref: one.ref, pinned: undefined })),
    models.map(info),
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
              },
        match: profile.match,
        why: profile.why,
        agent: profile.agent,
      },
      kept.kept,
      DEFAULT_AGENT,
    );

    if (found.resolution === undefined)
      return {
        profile: profile.name,
        alias: undefined,
        ref: undefined,
        rung: undefined,
        cost: undefined,
        crosscheck: undefined,
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
      crosscheckProblem: found.resolution.crosscheckProblem,
      problem: undefined,
    };
  });
};

/** One answer to "what should the second opinion be": nothing, or an effort. */
export type CrosscheckChoice =
  | { readonly kind: "off" }
  | { readonly kind: "effort"; readonly effort: string | undefined };

type CrosscheckResult =
  | {
      readonly available: true;
      /** The ref the choice would spend. `Off` is available and spends nothing. */
      readonly resolved: string | undefined;
      readonly reason: undefined;
    }
  | {
      readonly available: false;
      readonly resolved: undefined;
      readonly reason: string;
    };

export type CrosscheckOption = {
  readonly choice: CrosscheckChoice;
  readonly label: string;
  readonly current: boolean;
} & CrosscheckResult;

/**
 * The crosscheck choices for one profile, resolved by the same rule the router
 * runs. `Profile effort` asks the second opinion at the profile's own effort,
 * which is what a crosscheck with no `effort` means.
 */
export const crosscheckOptionsFor = (
  draft: Draft,
  models: ReadonlyArray<Model>,
  profile: Profile,
): ReadonlyArray<CrosscheckOption> => {
  const kept = candidates(
    draft.models.map((one) => ({ alias: one.alias, ref: one.ref, pinned: undefined })),
    models.map(info),
  ).kept;

  const trial = (effort: string | undefined): CrosscheckResult => {
    if (effort === undefined && profile.effort === undefined)
      return {
        available: false,
        resolved: undefined,
        reason: "The profile states no effort, so the crosscheck has no requirement to read.",
      };

    const found = resolveProfile(
      profile.name,
      {
        effort: profile.effort,
        model: profile.pinned === undefined ? undefined : [profile.pinned],
        crosscheck: { effort },
        match: profile.match,
        why: profile.why,
        agent: profile.agent,
      },
      kept,
      DEFAULT_AGENT,
    );

    if (found.resolution === undefined)
      return {
        available: false,
        resolved: undefined,
        reason: found.problem ?? "The resolver returned no row.",
      };
    const crosscheck = found.resolution.crosscheck;
    if (crosscheck === undefined)
      return {
        available: false,
        resolved: undefined,
        reason: found.resolution.crosscheckProblem ?? "The resolver returned no second opinion.",
      };
    return { available: true, resolved: spendRef(crosscheck), reason: undefined };
  };

  const names: Array<string> = [...KNOWN_ORDER];
  for (const candidate of kept) {
    for (const rung of candidate.model.rungs) if (!names.includes(rung)) names.push(rung);
  }
  if (profile.effort !== undefined && !names.includes(profile.effort)) names.push(profile.effort);
  const configured = profile.crosscheck?.effort;
  if (configured !== undefined && !names.includes(configured)) names.push(configured);

  const rows: Array<CrosscheckOption> = [
    {
      choice: { kind: "off" },
      label: "Off",
      current: profile.crosscheck === undefined,
      available: true,
      resolved: undefined,
      reason: undefined,
    },
    {
      choice: { kind: "effort", effort: undefined },
      label: "Profile effort",
      current: profile.crosscheck !== undefined && profile.crosscheck.effort === undefined,
      ...trial(undefined),
    },
  ];

  for (const name of names) {
    const choice: CrosscheckChoice = { kind: "effort", effort: name };
    rows.push({
      choice,
      label: name,
      current: profile.crosscheck?.effort === name,
      ...trial(name),
    });
  }

  return rows;
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
              },
        match: one.match,
        why: one.why,
        agent: one.agent === DEFAULT_AGENT ? undefined : one.agent,
      },
    ]),
  ),
});

export const formatConfig = (draft: Draft): string => serialise(written(draft)).trimEnd();

export const save = (draft: Draft): Promise<void> => {
  const path = `${draft.directory}/${FILE_NAME}`;
  return preserved(path).then((kept) => {
    const rest = { ...kept };
    delete rest.setup;
    delete rest.judge;
    const file = { ...rest, ...written(draft) } as Parameters<typeof writeConfig>[1];
    return Effect.runPromise(writeConfig(path, file));
  });
};
