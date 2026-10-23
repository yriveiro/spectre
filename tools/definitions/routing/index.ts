import type { Plugin } from "@opencode/plugin/effect";
import { Integration } from "@opencode/plugin/effect";
import type { Model } from "@opencode/schema/model";
import type { Tool } from "@opencode/schema/tool";
import { Effect, Schema } from "effect";
import { agentIds } from "../../../agents";
import { candidates } from "./catalogue";
import { check } from "./check";
import { jevJudge, SYSTEMONE_KEY_ENV } from "./jev";
import { type Judge, lexicalJudge, surface, type Verdict } from "./judge";
import { decode, load } from "./load";
import { FILE_NAME } from "./locate";
import { decide } from "./policy";
import { resolve } from "./resolve";
import {
  DEFAULT_AGENT,
  type Excluded as ExcludedRow,
  type File,
  type Pick,
  type Tables,
} from "./types";
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
 * The judge is optional, and a `resolved` answer says which path chose the
 * profile. The judge names a profile and never a model, so it cannot change
 * what the resolver spent. A judge that is absent, quiet or broken is a
 * `skipped` answer and not a failed call.
 *
 * @see features/routing.md
 */

const Input = Schema.Struct({
  profile: Schema.optional(Schema.String).annotate({
    description: "One profile name, to get just that row. Omit it for the whole table.",
  }),
  task: Schema.optional(Schema.String).annotate({
    description:
      "The task statement, when the caller wants the judge to choose the profile. Omit it and choose the profile yourself against the `match` lines.",
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

/**
 * Which path chose the profile: the judge, or the caller reading the `match`
 * lines. A `skipped` answer carries the reason in words the session can say out
 * loud, because the session then chooses the profile itself.
 */
const Judged = Schema.Union([
  Schema.Struct({
    status: Schema.Literals(["used"]),
    /** The profile the judge chose. It names no model. */
    profile: Schema.String,
    /** The probability the judge reported, when its arm reports one. */
    confidence: Schema.optional(Schema.Number),
    /** True when the profile was spent one step above its own effort. */
    escalated: Schema.optional(Schema.Boolean),
    /** The effort the profile was spent at, when it was raised. */
    effort: Schema.optional(Schema.String),
    /**
     * The other profiles the judge gave a probability to, best first. They
     * are the second readings of the same task, and a session that disagrees
     * with the judge can see them.
     */
    alternatives: Schema.optional(
      Schema.Array(
        Schema.Struct({
          profile: Schema.String,
          probability: Schema.Number,
        }),
      ),
    ),
  }),
  Schema.Struct({
    status: Schema.Literals(["skipped"]),
    /** Why the judge gave no profile. */
    reason: Schema.String,
  }),
]);

const Resolved = Schema.Struct({
  status: Schema.Literals(["resolved"]),
  profiles: Schema.Array(Profile),
  /** The spendable allowlist, in the order the config lists it. */
  models: Schema.Array(Row),
  sources: Schema.Array(Schema.String),
  /** The names the caller asked for. Empty on a whole-table call. */
  asked: Schema.Array(Schema.String),
  /** The judge's answer, or why it was not asked. Present on every answer. */
  judge: Judged,
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

Call it with no \`profile\` to get every profile. Each row carries the profile's \`match\` line, which says when that profile fits, and one \`model\`: the ref the resolver chose, the rung it asked for, and the cost. Take the profile whose \`match\` fits the task, and pass \`model.ref\` to the subagent tool unchanged, variant included.

  const t = await tools.spectre.routing({})
  subagent({ agent: t.profiles[0].agent, prompt: "<the task>", model: t.profiles[0].model.ref })

Pass \`task\` when you want the judge to choose the profile: \`routing({ task: "<the task>" })\`. The judge names a profile and never a model, so take \`model.ref\` from that profile's row unchanged. When \`judge.status\` is \`used\`, spend the row named \`judge.profile\`. When it is \`skipped\`, choose the profile yourself against the \`match\` lines. A skipped judge is a complete answer, and the routing is no less correct for it.

What comes back, by \`status\`:

- \`resolved\`: \`profiles\` has one row per profile. \`model\` is the model to spend: \`ref\` is the full string to pass, rung included, and \`rung\` is the level it names. \`pinned\` says the allowlist named the variant, \`steppedUp\` says the ladder had no rung at the requirement and stepped up, \`below\` is the rung under it, and \`family\`, \`rungs\` and \`cost\` describe the model. \`crosscheck\` is the second opinion when the profile asks for one, and \`crosscheckProblem\` says why a declared second opinion found none. \`excluded\` lists the candidates that did not qualify, each with the highest rung it reaches. \`models\` is the allowlist, \`sources\` the config files that were read, and \`asked\` the profile names you asked for. \`judge\` says which path chose the profile: \`used\` carries the \`profile\` it chose and the \`confidence\` when its arm reports one, and \`skipped\` carries the \`reason\` it gave none.
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

/** A judge that gave no profile, and why. */
const skipped = (reason: string): typeof Judged.Type => ({ status: "skipped", reason });

/** The words a thrown failure is reported in. */
const text = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

/** The judge's verdict as the output carries it. */
const judged = (verdict: Verdict): typeof Judged.Type =>
  verdict.kind === "quiet"
    ? skipped(verdict.why)
    : { status: "used", profile: verdict.profile, confidence: verdict.confidence };

/** The profiles an arm can pick, as the criteria a System One question carries. */
const criteria = (profiles: Tables["profiles"]): Record<string, string> =>
  Object.fromEntries(surface(profiles).map((one) => [one.profile, one.text]));

/**
 * The judge the config asks for, or `undefined` when it asks for none.
 *
 * `kind` names the arm. An absent `kind` is the System One arm, which is the one
 * the feature's own config example writes: it names an endpoint and a model and
 * no `kind`. The lexical arm is asked for by name, because it reads no settings,
 * and a config that names a setting expects the arm that uses it.
 */
const judgeFor = (ctx: Plugin.Context, tables: Tables): Effect.Effect<Judge | undefined> =>
  Effect.gen(function* () {
    const settings = tables.judge;
    if (settings === undefined) return undefined;
    if (settings.kind === "lexical") return lexicalJudge(tables.profiles);
    // The key the arm carries. The config's `key` names a variable, and that
    // variable wins. When it names none, the arm asks for the Console key,
    // because the Console key is the one that authenticates the Console's own
    // inference host, and a person who has connected the Console already has
    // it. The credential comes from the host's integration API and not from a
    // file, so the plugin does not depend on where the host keeps it.
    const keyEnv = settings.key ?? SYSTEMONE_KEY_ENV;
    const named = yield* Effect.sync(() => Bun.env[keyEnv]);
    const held = named ?? (yield* consoleKey(ctx));
    return jevJudge(
      {
        endpoint: settings.endpoint,
        model: settings.model,
        keyEnv,
        timeout: settings.timeout,
      },
      criteria(tables.profiles),
      { env: (name: string) => (name === keyEnv ? held : Bun.env[name]) },
    );
  });

/**
 * The Console's own credential, when the host holds one.
 *
 * A provider without its own integration id uses its provider id as the
 * integration id, which is how the host resolves every provider's credential
 * (`packages/core/src/model-resolver.ts:373-376` at `v2.1.1`). The Console
 * provider is the integration `opencode`.
 */
const consoleKey = (ctx: Plugin.Context): Effect.Effect<string | undefined> =>
  Effect.gen(function* () {
    // A context without the integration domain cannot answer, and a host that
    // does not have one is not a failure: the arm asks the environment
    // instead.
    const integration = (ctx as { readonly integration?: Plugin.Context["integration"] })
      .integration;
    if (integration === undefined) return undefined;
    const connection = yield* integration.connection
      .active(Integration.ID.make("opencode"))
      .pipe(Effect.catchCause(() => Effect.succeed(undefined)));
    if (connection === undefined) return undefined;
    const value = yield* integration.connection
      .resolve(connection)
      .pipe(Effect.catchCause(() => Effect.succeed(undefined)));
    if (value === null || typeof value !== "object") return undefined;
    const key = (value as { readonly key?: unknown }).key;
    return typeof key === "string" ? key : undefined;
  });

/**
 * The judge's answer, or the reason there is none.
 *
 * A judge never blocks the answer. A config with no judge, a call with no task,
 * a profile the caller already named and a judge that throws all arrive as
 * `skipped`, so the table still comes back whole and the session chooses the
 * profile itself.
 */
const ask = (
  judge: Judge | undefined,
  task: string | undefined,
  profile: string | undefined,
): Effect.Effect<typeof Judged.Type> =>
  Effect.gen(function* () {
    if (judge === undefined)
      return skipped("The config names no judge, so the profile choice is yours.");
    if (task === undefined) return skipped("The call names no task, so the judge was not asked.");
    if (profile !== undefined)
      return skipped("The call names a profile, so the choice is already made.");

    const verdict = yield* Effect.match(
      Effect.tryPromise({ try: () => judge.judge(task), catch: (cause) => cause }),
      {
        onFailure: (cause): Verdict => ({
          kind: "quiet",
          why: `The judge stopped with an error: ${text(cause)}`,
        }),
        onSuccess: (one) => one,
      },
    );
    return judged(verdict);
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

      // The judge is asked last, so a config with a problem never spends a
      // request.
      let judgement = yield* ask(yield* judgeFor(ctx, found.tables), input.task, input.profile);

      // An unsure judge plays safe.
      //
      // A probability below the threshold means the judge does not know which
      // profile this is, and not knowing is a reason to spend more rather than
      // less: the profile the judge named is spent one step above its own
      // effort. The threshold is measured, not guessed. On the routing corpus
      // no hit sits below 0.7 and the one low-confidence mistake sits at 0.46,
      // so this rule catches that mistake and costs nothing. It cannot catch a
      // confident mistake, and nothing can: two of the three mistakes on the
      // corpus came with a probability of 0.98.
      let table = shown;
      if (judgement.status === "used") {
        const { profile } = judgement;
        const choice = decide(
          {
            profile,
            confidence: judgement.confidence,
            alternatives: judgement.alternatives,
          },
          found.tables.profiles,
          found.tables.judge?.threshold,
        );
        const entry = found.tables.profiles[profile];
        if (choice?.escalated === true && entry !== undefined) {
          const one = resolve(
            profile,
            { ...entry, effort: choice.effort },
            kept.kept,
            DEFAULT_AGENT,
          );
          if (one.problem === undefined && one.resolution !== undefined) {
            const row = {
              name: profile,
              match: entry.match,
              effort: choice.effort,
              agent: one.resolution.agent,
              model: spent(one.resolution.primary),
              crosscheck:
                one.resolution.crosscheck === undefined
                  ? undefined
                  : spent(one.resolution.crosscheck),
              crosscheckProblem: one.resolution.crosscheckProblem,
              excluded: one.resolution.excluded.map(notThis),
            };
            table = shown.map((one) => (one.name === profile ? row : one));
            judgement = {
              ...judgement,
              escalated: true,
              effort: choice.effort,
              alternatives: choice.alternatives,
            };
          }
        }
      }

      if (judgement.status === "used") {
        // The alternatives are the judge's second readings, and a session
        // that disagrees with the judge needs to see them. The judge's own
        // answer is not one of them.
        const { profile } = judgement;
        const alternatives = judgement.alternatives ?? [];
        judgement = {
          ...judgement,
          alternatives: alternatives.filter((one) => one.profile !== profile),
        };
      }

      return {
        output: {
          status: "resolved",
          profiles:
            input.profile === undefined ? table : table.filter((one) => one.name === input.profile),
          models: kept.kept.map((one) => ({ name: one.alias, model: one.ref })),
          sources: [...found.sources],
          asked: input.profile === undefined ? [] : [input.profile],
          judge: judgement,
        },
      };
    }),
});

/**
 * The public surface of this folder.
 *
 * The tool is the first consumer. The terminal page is the second, and it
 * needs the same reader, the same resolver and the same writer, so a page
 * cannot show something the router will not do. The judge is exported for the
 * eval harness, so the measurement reads the arm the tool runs and not a copy
 * of it. Nothing above `definitions/` imports a sibling of this folder: a
 * second consumer of the internals is the signal that the boundary is wrong,
 * and the answer is the declaration deciding what is public.
 */
export { candidates, isFree, known, ladder } from "./catalogue";
export { effortOf, fit, KNOWN_ORDER, ladderOf, rungs } from "./effort";
export type { JevDeps, JevSettings } from "./jev";
export { DEFAULT_TIMEOUT_MS, jevJudge, SYSTEMONE_ENDPOINT, SYSTEMONE_KEY_ENV } from "./jev";
export type { Description, Judge, Verdict } from "./judge";
export { lexicalJudge, rank, surface } from "./judge";
export { load, loadProject } from "./load";
export { FILE_NAME, LEGACY_NAME, projectPath } from "./locate";
export type { Choice } from "./policy";
export { decide, oneStepUp, PLAY_SAFE } from "./policy";
export { resolve as resolveProfile } from "./resolve";
export type {
  Allowed,
  Candidate,
  Crosscheck,
  Excluded,
  JudgeConfig,
  Known,
  Pick,
  Profile,
  ProfileEntry,
  Resolution,
  Tables,
} from "./types";
export { DEFAULT_AGENT, formatRef } from "./types";
export { proposeAlias, serialise, writeConfig } from "./write";
