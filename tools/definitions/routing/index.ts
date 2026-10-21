import type { Plugin } from "@opencode/plugin/effect";
import type { Model } from "@opencode/schema/model";
import type { Tool } from "@opencode/schema/tool";
import { Effect, Schema } from "effect";
import { agentIds } from "../../../agents";
import { candidates } from "./catalogue";
import { check } from "./check";
import { decode, load } from "./load";
import { FILE_NAME } from "./locate";
import { resolve } from "./resolve";
import { DEFAULT_AGENT, type Excluded as ExcludedRow, type File, type Pick } from "./types";
import { writeConfig } from "./write";

/**
 * The routing tool, and the only surface a session reads.
 *
 * The output is a union of four structs, so an outcome carries the fields it
 * has and no others. `resolved` is a model to spend, `setup` is a repository
 * with no config, `declined` is the stored answer "no", and `problems` is a
 * config that cannot be routed on.
 *
 * The config is read on every call, so an edit made mid-session routes on the
 * edit. The policy is `resolve.ts`, and the validation is `check.ts`.
 *
 * @see features/routing.md
 */

const Input = Schema.Struct({
  profile: Schema.optional(Schema.String).annotate({
    description: "One profile name, to get just that row. Omit it for the whole table.",
  }),
  setup: Schema.optional(Schema.Literals(["accepted", "declined"])).annotate({
    description:
      "The answer to the setup question, once the user gives it. `accepted` writes the starter set and resolves it. `declined` writes the marker, so the question never comes again.",
  }),
});

const Row = Schema.Struct({ name: Schema.String, model: Schema.String });

/** A model the resolver spent, and the facts behind the choice. */
const Spent = Schema.Struct({
  ref: Schema.String,
  rung: Schema.optional(Schema.String),
  pinned: Schema.Boolean,
  steppedUp: Schema.Boolean,
  below: Schema.optional(Schema.String),
  family: Schema.optional(Schema.String),
  rungs: Schema.Array(Schema.String),
  cost: Schema.Struct({ input: Schema.Number, output: Schema.Number }),
});

/** A candidate that did not qualify, and how far it reaches. */
const NotThis = Schema.Struct({
  name: Schema.String,
  ref: Schema.String,
  reason: Schema.String,
  rungs: Schema.Array(Schema.String),
  reaches: Schema.optional(Schema.String),
});

const Profile = Schema.Struct({
  name: Schema.String,
  /** The routing surface: when this profile fits. */
  match: Schema.optional(Schema.String),
  /** The requirement the user wrote. */
  effort: Schema.optional(Schema.String),
  agent: Schema.String,
  model: Spent,
  crosscheck: Schema.optional(Spent),
  crosscheckProblem: Schema.optional(Schema.String),
  excluded: Schema.Array(NotThis),
});

const Resolved = Schema.Struct({
  status: Schema.Literals(["resolved"]),
  profiles: Schema.Array(Profile),
  /** The spendable allowlist, in the order the config lists it. */
  models: Schema.Array(Row),
  sources: Schema.Array(Schema.String),
  /** The names the caller asked for. Empty on a whole-table call. */
  asked: Schema.Array(Schema.String),
});

const StarterProfile = Schema.Struct({
  name: Schema.String,
  effort: Schema.optional(Schema.String),
});

const Setup = Schema.Struct({
  status: Schema.Literals(["setup"]),
  provider: Schema.optional(Schema.String),
  models: Schema.Array(Row),
  profiles: Schema.Array(StarterProfile),
  /** The file the setup path looks for and writes. */
  source: Schema.String,
});

const Declined = Schema.Struct({
  status: Schema.Literals(["declined"]),
  /** The file that carries the stored answer. */
  source: Schema.String,
});

const Problems = Schema.Struct({
  status: Schema.Literals(["problems"]),
  /** Every problem, one per line, each naming the key that is wrong. */
  problems: Schema.String,
});

const Output = Schema.Union([Resolved, Setup, Declined, Problems]);

/** Exported so a test can name it: `Tool.Info.output` is optional on the type. */
export type Page = typeof Output.Type;

const DESCRIPTION = `Route a task to a model: resolve each profile's requirement against the models this project allows, and return the ref to spend.

Call it with no argument for every profile. Each row carries the profile's \`match\` line, which says when that profile fits, and one \`model\`: the ref the resolver chose, the rung it asked for, and the cost. Take the profile whose \`match\` fits the task, and pass \`model.ref\` to the subagent tool unchanged, variant included.

  const t = await tools.spectre.routing({})
  subagent({ agent: t.profiles[0].agent, prompt: "<the task>", model: t.profiles[0].model.ref })

What comes back, by \`status\`:

- \`resolved\`: \`profiles\` has one row per profile. \`model\` is the model to spend: \`ref\` is the full string to pass, rung included, and \`rung\` is the level it names. \`pinned\` says the allowlist named the variant, \`steppedUp\` says the ladder had no rung at the requirement and stepped up, \`below\` is the rung under it, and \`family\`, \`rungs\` and \`cost\` describe the model. \`crosscheck\` is the second opinion when the profile asks for one, and \`crosscheckProblem\` says why a declared second opinion found none. \`excluded\` lists the candidates that did not qualify, each with the highest rung it reaches. \`models\` is the allowlist, \`sources\` the config files that were read, and \`asked\` the profile names you asked for.
- \`setup\`: the repository has no config. \`provider\`, \`models\` and \`profiles\` are the starter set on the table. Ask the user once, then call this tool again with \`setup: "accepted"\` or \`setup: "declined"\`. Do not write a config by hand.
- \`declined\`: the user already said no. Do not ask again. Spawn without \`model\`, and the agent's own model runs the work.
- \`problems\`: the config is wrong. Every mistake is on its own line and names the key. Quote it, say routing is misconfigured, and ask whether to continue on the current model. Do not substitute a model you remember.

The allowlist is the whole vocabulary. A ref that is not in \`models\` is not spendable on a spectre subagent, however many models the provider offers. Never write a model id from memory. If nothing here fits, say so and ask.

A profile states what a task needs in \`effort\` and when to reach for it in \`match\`. The resolver reads the allowlist order and the live catalogue. It never reads \`why\`, which is the rationale for the human.`;

const catalogue = (ctx: Plugin.Context) =>
  ctx.model.list().pipe(
    Effect.map((out) => ({ models: out.data, problem: undefined }) as const),
    Effect.catchCause(() =>
      Effect.succeed({
        models: [] as ReadonlyArray<Model.Info>,
        problem: `the model catalogue could not be read, so no model was checked`,
      } as const),
    ),
  );

/** The allowlist as rows, in the order the config lists it. */
const rows = (
  record: Readonly<Record<string, string | null>> | undefined,
): ReadonlyArray<typeof Row.Type> =>
  Object.entries(record ?? {}).flatMap(([name, model]) =>
    model === null ? [] : [{ name, model }],
  );

/** The starter profiles as a reader needs them on the table. */
const starterProfiles = (
  record: Readonly<Record<string, { readonly effort?: string | undefined } | null>> | undefined,
): ReadonlyArray<typeof StarterProfile.Type> =>
  Object.entries(record ?? {}).flatMap(([name, entry]) =>
    entry === null ? [] : [{ name, effort: entry.effort }],
  );

/**
 * The ref to spend. The resolver keeps the rung beside the ref, so the tool
 * composes the string the session passes: `provider/id#rung`. A ref the
 * allowlist already pinned carries its variant, and a model with no rung has
 * nothing to add.
 */
const spendRef = (one: Pick): string =>
  one.rung === undefined || one.ref.includes("#") ? one.ref : `${one.ref}#${one.rung}`;

/** A spent model as the output carries it. */
const spent = (one: Pick): typeof Spent.Type => ({
  ref: spendRef(one),
  rung: one.rung,
  pinned: one.pinned,
  steppedUp: one.steppedUp,
  below: one.below,
  family: one.family,
  rungs: [...one.rungs],
  cost: { input: one.costInput, output: one.costOutput },
});

/** A candidate that did not qualify as the output carries it. */
const notThis = (one: ExcludedRow): typeof NotThis.Type => ({
  name: one.alias,
  ref: one.ref,
  reason: one.reason,
  rungs: [...one.rungs],
  reaches: one.reaches,
});

const failed = (lines: ReadonlyArray<string>): { output: Page } => ({
  output: { status: "problems", problems: lines.join("\n") },
});

type Starter = { readonly file?: File; readonly problem?: string };

/**
 * The starter set the setup path writes. It sits at the package root, beside
 * `index.ts`, so a checkout and an installed copy carry it the same way.
 */
const starter: Effect.Effect<Starter> = Effect.gen(function* () {
  // `import.meta.dir` is the Bun answer for the package root. The joins here are
  // one separator and one parent walk, so no path module is needed.
  const path = `${import.meta.dir}/../../../spectre.default.json`;
  const file = Bun.file(path);
  if (!(yield* Effect.promise(() => file.exists())))
    return { problem: `${path}: the starter set is missing` };
  return decode(path, yield* Effect.promise(() => file.text()));
});

/**
 * Write the answer to the setup question. The error channel of `writeConfig`
 * becomes a message the session can read, so a refusal is a problem line and
 * not a failed call.
 */
const answer = (mode: "accepted" | "declined", path: string): Effect.Effect<string | undefined> =>
  Effect.gen(function* () {
    if (mode === "declined")
      return yield* Effect.match(writeConfig(path, { setup: "declined" }), {
        onFailure: (problem) => problem,
        onSuccess: () => undefined,
      });

    const set = yield* starter;
    if (set.problem !== undefined) return set.problem;
    if (set.file === undefined) return `${path}: the starter set could not be read`;
    return yield* Effect.match(writeConfig(path, set.file), {
      onFailure: (problem) => problem,
      onSuccess: () => undefined,
    });
  });

export const routing = (ctx: Plugin.Context): Tool.Info<typeof Input, typeof Output> => ({
  name: "routing",
  description: DESCRIPTION,
  input: Input,
  output: Output,
  options: {
    namespace: "spectre",
    codemode: true,
    pinned: true,
    permission: "read",
  },
  execute: (input) =>
    Effect.gen(function* () {
      const directory = ctx.location.directory;
      const path = `${directory}/${FILE_NAME}`;

      // The setup action writes one file and then answers from what it wrote.
      // It refuses when routing is already configured, because a second answer
      // would replace a working config with a marker or a starter set.
      if (input.setup !== undefined) {
        const before = yield* load(directory);
        if (before.sources.length > 0)
          return failed([
            `${input.setup}: routing is already configured by ${before.sources.join(", ")}. Remove that file to set up again.`,
          ]);
        const refused = yield* answer(input.setup, path);
        if (refused !== undefined) return failed([refused]);
      }

      const found = yield* load(directory);

      // No file anywhere: the repository has not answered the setup question.
      if (found.sources.length === 0) {
        const set = yield* starter;
        if (set.problem !== undefined) return failed([set.problem]);
        if (set.file === undefined) return failed([`${path}: the starter set could not be read`]);
        return {
          output: {
            status: "setup",
            provider: set.file.provider,
            models: rows(set.file.models),
            profiles: starterProfiles(set.file.profiles),
            source: path,
          },
        };
      }

      // The user said no before. The marker is the answer, so the question does
      // not come again and this repository routes on no model.
      if (found.tables.setup !== undefined)
        return {
          output: {
            status: "declined",
            source: found.tables.setup.from,
          },
        };

      const listed = yield* catalogue(ctx);
      const checked = check(found.tables, listed.models, DEFAULT_AGENT, agentIds);
      const allowed = Object.entries(found.tables.models).map(([alias, ref]) => ({
        alias,
        ref,
        pinned: undefined,
      }));
      const kept = candidates(allowed, listed.models);

      // Every problem is collected before the answer is built, because one bad
      // row withholds the whole table. The problems from `candidates` are only
      // added when `check` found none: the two report the same bad ref, and one
      // line per mistake is the rule.
      const lines = [...found.problems];
      if (listed.problem !== undefined) lines.push(listed.problem);
      lines.push(...checked.problems);
      if (lines.length === 0 && kept.missing.length > 0)
        lines.push(...kept.missing.map((one) => `models.${one.alias}: ${one.reason}`));
      if (lines.length === 0 && allowed.length === 0)
        lines.push(`${FILE_NAME}: models is empty, so no model routes`);
      if (lines.length > 0) return failed(lines);

      const shown: Array<typeof Profile.Type> = [];
      for (const [name, entry] of Object.entries(found.tables.profiles)) {
        const one = resolve(name, entry, kept.kept, DEFAULT_AGENT);
        if (one.problem !== undefined) {
          lines.push(one.problem);
          continue;
        }
        if (one.resolution === undefined) continue;
        shown.push({
          name,
          match: entry.match,
          effort: entry.effort,
          agent: one.resolution.agent,
          model: spent(one.resolution.primary),
          crosscheck:
            one.resolution.crosscheck === undefined ? undefined : spent(one.resolution.crosscheck),
          crosscheckProblem: one.resolution.crosscheckProblem,
          excluded: one.resolution.excluded.map(notThis),
        });
      }
      if (lines.length > 0) return failed(lines);

      return {
        output: {
          status: "resolved",
          profiles:
            input.profile === undefined ? shown : shown.filter((one) => one.name === input.profile),
          models: kept.kept.map((one) => ({ name: one.alias, model: one.ref })),
          sources: [...found.sources],
          asked: input.profile === undefined ? [] : [input.profile],
        },
      };
    }),
});
