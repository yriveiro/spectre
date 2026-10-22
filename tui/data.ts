import type { ModelInfo } from "@opencode/client";
import type { Model as Schema } from "@opencode/schema/model";
import { Effect } from "effect";
import {
  candidates,
  DEFAULT_AGENT,
  FILE_NAME,
  known,
  loadProject,
  type ProfileEntry,
  projectPath,
  resolveProfile,
  type Pick as Spent,
  writeConfig,
} from "../tools/definitions/routing/index.ts";

/**
 * What the page holds, and what it shows.
 *
 * The page reads the same config file the tool reads, and it resolves the same
 * way the tool resolves, so the page cannot promise something the router will
 * not do. The catalogue comes from the terminal's own model list, which is the
 * list the session sees.
 */

/** One model of the catalogue, reduced to what the page shows. */
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
  /** A model that cannot call tools is not spendable on a subagent. */
  readonly tools: boolean;
};

/** A profile as the page edits it. */
export type Profile = {
  readonly name: string;
  /** The thinking the task needs. */
  readonly effort: string | undefined;
  /** The routing surface. */
  readonly match: string | undefined;
  /** The rationale, for the human. */
  readonly why: string | undefined;
  /** The second opinion, stated as a requirement. */
  readonly crosscheck:
    | { readonly effort: string | undefined; readonly prefer: string | undefined }
    | undefined;
  /** The agent the run happens under. */
  readonly agent: string;
  /** A pinned model, when the profile names one. */
  readonly pinned: string | undefined;
};

/** The config as the page holds it. */
export type Draft = {
  readonly provider: string | undefined;
  /** The allowlist, in the order the resolver reads. */
  readonly models: ReadonlyArray<{ readonly alias: string; readonly ref: string }>;
  readonly profiles: ReadonlyArray<Profile>;
};

/** What one profile resolves to under a draft. */
export type Resolution = {
  readonly profile: string;
  /** The ref the resolver would spend, variant included. */
  readonly ref: string | undefined;
  readonly rung: string | undefined;
  /** The cost, in the catalogue's units. */
  readonly cost: string | undefined;
  /** The second opinion, when the profile asks for one. */
  readonly crosscheck: string | undefined;
  /** Why a profile resolved to nothing. */
  readonly problem: string | undefined;
};

/**
 * The canonical file name. The barrel does not export it, and the reader takes
 * this name before the legacy `.jsonc` one, so the writer owns this file.
 */

/** The cost as one string, in dollars per million tokens. */
const money = (value: number): string => `$${value}`;

/**
 * The ref to spend, composed as the tool composes it: one rung is a `#`
 * suffix, and a ref the allowlist pinned already carries it.
 */
const spendRef = (one: Spent): string =>
  one.rung === undefined || one.ref.includes("#") ? one.ref : `${one.ref}#${one.rung}`;

/** The pinned names as a list, whether the entry carries one or several. */
const pins = (model: ProfileEntry["model"]): ReadonlyArray<string> => {
  if (model === undefined) return [];
  return typeof model === "string" ? [model] : model;
};

/**
 * The config file the draft came from, or undefined when the project has none.
 *
 * The page names the file in its heading, and it cannot work the name out: the
 * reader is the only thing that knows which of the two names a directory
 * holds.
 */
export const source = (directory: string): Promise<string | undefined> =>
  Effect.runPromise(projectPath(directory));

/** The config in the directory, or an empty draft when there is none. */
export const read = (directory: string): Promise<Draft> =>
  Effect.runPromise(loadProject(directory)).then((found) => {
    const models = Object.entries(found.tables.models).map(([alias, ref]) => ({ alias, ref }));
    const held = new Set(models.map((one) => one.alias));

    // A file that does not decode contributes no table, and this shape has no
    // field for the problem. `save` decodes the project file again and refuses
    // with the reader's message, so a broken file is never replaced in
    // silence.
    return {
      provider: found.tables.provider,
      models,
      profiles: Object.entries(found.tables.profiles).map(([name, entry]) => {
        // The resolver spends the first pin the allowlist holds. The page
        // shows that name, because it is the name the page can edit.
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
        };
      }),
    };
  });

/**
 * A catalogue row, and the two facts `known` reads that the page does not
 * show. `catalogue` builds the row, so `resolve` reads what the catalogue said
 * instead of a value it guessed.
 */
type Row = Model & {
  readonly status?: string;
  readonly tools?: boolean;
};

/** The catalogue, reduced. */
export const catalogue = (models: ReadonlyArray<ModelInfo>): ReadonlyArray<Model> => {
  const rows: Array<Row> = [];
  for (const info of models) {
    // The terminal's row and the schema's row describe one model. The
    // terminal type carries no brand, so the boundary casts once and `known`
    // reads the fields.
    const one = known(info as unknown as Schema.Info);
    rows.push({ ...one, deprecated: one.status === "deprecated" });
  }
  return rows;
};

/** The schema row behind a reduced model, for the barrel's `candidates`. */
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

/** What every profile resolves to under a draft. */
export const resolve = (draft: Draft, models: ReadonlyArray<Model>): ReadonlyArray<Resolution> => {
  const kept = candidates(
    draft.models.map((one) => ({ alias: one.alias, ref: one.ref, pinned: undefined })),
    models.map(info),
  );

  return draft.profiles.map((profile): Resolution => {
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
      cost: `${money(primary.costInput)} in / ${money(primary.costOutput)} out`,
      crosscheck: crosscheck === undefined ? undefined : spendRef(crosscheck),
      problem: undefined,
    };
  });
};

/**
 * The keys of the file the page does not edit. The writer owns the whole
 * file, so a key it cannot see would be lost on the first save. The writer
 * decodes the file again and refuses a broken one, so this read carries no
 * policy of its own.
 */
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

/** The draft as the file declares it. */
const written = (draft: Draft): Parameters<typeof writeConfig>[1] => ({
  provider: draft.provider,
  models: Object.fromEntries(draft.models.map((one) => [one.alias, one.ref])),
  profiles: Object.fromEntries(
    draft.profiles.map((one) => [
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
        // The default is implicit. A profile that does not name an agent
        // takes the default, so the file does not state it again.
        agent: one.agent === DEFAULT_AGENT ? undefined : one.agent,
      },
    ]),
  ),
});

/** The config written to the directory. */
export const save = (directory: string, draft: Draft): Promise<void> => {
  const path = `${directory}/${FILE_NAME}`;
  return preserved(path).then((kept) => {
    // The marker says "do not route", and a person who saves a config on the
    // page answers the question again. The marker goes.
    const rest = { ...kept };
    delete rest.setup;
    const file = { ...rest, ...written(draft) } as Parameters<typeof writeConfig>[1];
    return Effect.runPromise(writeConfig(path, file));
  });
};
