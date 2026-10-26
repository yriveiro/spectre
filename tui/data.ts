import type { ModelInfo } from "@opencode/client";
import type { Model as Schema } from "@opencode/schema/model";
import { Effect } from "effect";
import {
  candidates,
  DEFAULT_AGENT,
  DEFAULT_PROFILES,
  FILE_NAME,
  isDefaultProfile,
  type JudgeConfig,
  known,
  loadProject,
  type ProfileEntry,
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
  readonly crosscheck:
    | { readonly effort: string | undefined; readonly prefer: string | undefined }
    | undefined;
  readonly agent: string;
  readonly pinned: string | undefined;
  readonly enabled?: boolean | undefined;
};

export type Draft = {
  readonly provider: string | undefined;
  readonly models: ReadonlyArray<{ readonly alias: string; readonly ref: string }>;
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
        : { effort: entry.crosscheck.effort, prefer: entry.crosscheck.prefer },
    agent: entry.agent ?? DEFAULT_AGENT,
    pinned: undefined,
    enabled,
  }));

export type Resolution = {
  readonly profile: string;
  readonly ref: string | undefined;
  readonly rung: string | undefined;
  readonly cost: string | undefined;
  readonly crosscheck: string | undefined;
  readonly problem: string | undefined;
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

export const source = (directory: string): Promise<string | undefined> =>
  Effect.runPromise(projectPath(directory));

export const read = (directory: string): Promise<Draft> =>
  Effect.runPromise(loadProject(directory)).then((found) => {
    const models = Object.entries(found.tables.models).map(([alias, ref]) => ({ alias, ref }));
    const held = new Set(models.map((one) => one.alias));

    if (!found.configuredProfiles) {
      return {
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
        crosscheck:
          entry.crosscheck === undefined
            ? undefined
            : { effort: entry.crosscheck.effort, prefer: entry.crosscheck.prefer },
        agent: entry.agent ?? DEFAULT_AGENT,
        pinned: named.find((one) => held.has(one)) ?? named[0],
        enabled: true,
      };
    });
    const configuredNames = new Set(fromFile.map((one) => one.name));
    const disabledDefaults = defaultProfiles(false).filter((one) => !configuredNames.has(one.name));

    return {
      provider: found.tables.provider,
      judge: found.tables.judge,
      models,
      profiles: [...fromFile, ...disabledDefaults],
    };
  });

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
                prefer: profile.crosscheck.prefer === "free" ? "free" : undefined,
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
        ref: undefined,
        rung: undefined,
        cost: undefined,
        crosscheck: undefined,
        problem: found.problem,
      };

    const primary = found.resolution.primary;
    const crosscheck = found.resolution.crosscheck;
    return {
      profile: profile.name,
      ref: spendRef(primary),
      rung: primary.rung,
      cost: formatCost(primary.costInput, primary.costOutput),
      crosscheck: crosscheck === undefined ? undefined : spendRef(crosscheck),
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
                prefer: one.crosscheck.prefer === "free" ? "free" : undefined,
              },
        match: one.match,
        why: one.why,
        agent: one.agent === DEFAULT_AGENT ? undefined : one.agent,
      },
    ]),
  ),
});

export const formatConfig = (draft: Draft): string => serialise(written(draft)).trimEnd();

export const save = (directory: string, draft: Draft): Promise<void> => {
  const path = `${directory}/${FILE_NAME}`;
  return preserved(path).then((kept) => {
    const rest = { ...kept };
    delete rest.setup;
    delete rest.judge;
    const file = { ...rest, ...written(draft) } as Parameters<typeof writeConfig>[1];
    return Effect.runPromise(writeConfig(path, file));
  });
};
