import type { Model, Plugin, Tool } from "@opencode/plugin/effect";
import { Effect, Schema } from "effect";
import { agentIds } from "../../../agents";
import { candidates, known, ladder } from "./catalogue";
import { check } from "./check";
import { clampEffort } from "./effort";
import { hostCatalogue, sessionState } from "./host";
import { jevJudge } from "./jev";
import { type Judge, lexicalJudge, surface, type Verdict } from "./judge";
import { decode, load } from "./load";
import { FILE_NAME, inheritedConfigPath, writePath } from "./locate";
import { crosscheckOf, priorityOf } from "./order";
import { decide } from "./policy";
import { resolve } from "./resolve";
import {
  type Candidate,
  DEFAULT_AGENT,
  DEFAULT_PROFILES,
  type Excluded as ExcludedRow,
  type File,
  type Pick,
  type Profile as ProfileSpec,
  type Resolution,
  type Tables,
} from "./types";
import { proposeAlias, writeConfig } from "./write";

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

const Row = Schema.Struct({
  name: Schema.String,
  model: Schema.String,
  /** The one-based place in the explicit model priority. */
  priority: Schema.Number,
  /** The catalogue family, when the row came from the live catalogue. */
  family: Schema.optional(Schema.String),
  /** The effort rungs the model declares, in catalogue order. */
  rungs: Schema.optional(Schema.Array(Schema.String)),
  /** What the model costs, per million tokens. */
  cost: Schema.optional(Schema.Struct({ input: Schema.Number, output: Schema.Number })),
});

/** A model the resolver spent, and the facts behind the choice. */
const Spent = Schema.Struct({
  ref: Schema.String,
  rung: Schema.optional(Schema.String),
  /** True when the profile named this model with a `model` pin. */
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
  models: Schema.Array(Row).annotate({
    description: "The spendable allowlist, in `priority` order.",
  }),
  crosscheck: Schema.Array(Row).annotate({
    description:
      "The models that may serve a crosscheck, in fallback order. Each row's `priority` is its place in the allowlist, not its place here.",
  }),
  sources: Schema.Array(Schema.String),
  asked: Schema.Array(Schema.String).annotate({
    description: "The names the caller asked for. Empty on a whole-table call.",
  }),
  judge: Judged.annotate({
    description: "The judge's answer, or why it was not asked. Present on every answer.",
  }),
  warnings: Schema.optional(Schema.Array(Schema.String)),
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
  /**
   * The allowlist order, when the models themselves are valid and a profile
   * or agent is the only problem. The order is still what the resolver reads.
   */
  models: Schema.optional(Schema.Array(Row)),
  /** The crosscheck fallback order, when the crosscheck list is valid too. */
  crosscheck: Schema.optional(Schema.Array(Row)),
});

const Output = Schema.Union([Resolved, Setup, Declined, Problems]);

/** Exported so a test can name it: `Tool.Info.output` is optional on the type. */
export type Page = typeof Output.Type;

const DESCRIPTION = `Resolve subagent model selection from spectre.json profiles, effort rungs, allowlist priority, and task judging.
Returns each profile's resolved provider/model#rung ref, agent, cost, and crosscheck model, or runs the configured task judge when task is given. Also handles initial routing setup ("accepted" or "declined") and reports config validation problems before spawning subagents.`;

/** The allowlist as rows, in the explicit priority order. */
const rows = (
  record: Readonly<Record<string, string | null>> | undefined,
  priority: ReadonlyArray<string> | undefined,
): ReadonlyArray<typeof Row.Type> => {
  const models = Object.fromEntries(
    Object.entries(record ?? {}).flatMap(([name, model]) =>
      model === null ? [] : [[name, model]],
    ),
  );
  return priorityOf(models, priority).ranked.map((one) => ({
    name: one.alias,
    model: one.ref,
    priority: one.priority,
  }));
};

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

const judgeFor = (ctx: Plugin.Context, tables: Tables): Judge | undefined => {
  const settings = tables.judge;
  if (settings === undefined) return undefined;
  if (settings.kind === "lexical") return lexicalJudge(tables.profiles);
  return jevJudge(
    { model: settings.model, endpoint: settings.endpoint, timeout: settings.timeout },
    criteria(tables.profiles),
    ctx.experimental.generate.decisions,
  );
};

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

    const verdict = yield* judge.judge(task).pipe(
      Effect.catchDefect(
        (cause): Effect.Effect<Verdict> =>
          Effect.succeed({
            kind: "quiet",
            why: `The judge stopped with an error: ${text(cause)}`,
          }),
      ),
    );
    return judged(verdict);
  });

const failed = (
  lines: ReadonlyArray<string>,
  models?: ReadonlyArray<typeof Row.Type>,
  crosscheck?: ReadonlyArray<typeof Row.Type>,
): { output: Page } => ({
  output: {
    status: "problems",
    problems: lines.join("\n"),
    ...(models === undefined ? {} : { models }),
    ...(crosscheck === undefined ? {} : { crosscheck }),
  },
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

const asRow = (one: Candidate, priority: number): typeof Row.Type => ({
  name: one.alias,
  model: one.ref,
  priority,
  family: one.model.family,
  rungs: [...one.model.rungs],
  cost: { input: one.model.costInput, output: one.model.costOutput },
});

const toProfileRow = (
  name: string,
  match: string | undefined,
  effort: string | undefined,
  resolution: Resolution,
): typeof Profile.Type => ({
  name,
  match,
  effort,
  agent: resolution.agent,
  model: spent(resolution.primary),
  crosscheck: resolution.crosscheck === undefined ? undefined : spent(resolution.crosscheck),
  crosscheckProblem: resolution.crosscheckProblem,
  excluded: resolution.excluded.map(notThis),
});

type JudgePassInput = {
  readonly ctx: Plugin.Context;
  readonly tables: Tables;
  readonly shown: ReadonlyArray<typeof Profile.Type>;
  readonly kept: ReadonlyArray<Candidate>;
  readonly input: { readonly task?: string | undefined; readonly profile?: string | undefined };
  readonly clamp?: ((effort: string | undefined) => string | undefined) | undefined;
};

const escalateChoice = (
  args: JudgePassInput,
  judgement: Extract<typeof Judged.Type, { readonly status: "used" }>,
) => {
  const { profile } = judgement;
  const choice = decide(
    { profile, confidence: judgement.confidence, alternatives: judgement.alternatives },
    args.tables.profiles,
    args.tables.judge?.threshold,
  );
  const entry = args.tables.profiles[profile];
  if (choice?.escalated !== true || entry === undefined) return undefined;
  const nextEffort = args.clamp === undefined ? choice.effort : args.clamp(choice.effort);
  const resolved = resolve(
    profile,
    { ...entry, effort: args.clamp === undefined ? nextEffort : (nextEffort ?? "none") },
    args.kept,
    DEFAULT_AGENT,
    args.tables.crosscheck,
  );
  if (resolved.problem !== undefined || resolved.resolution === undefined) return undefined;
  const row = toProfileRow(profile, entry.match, nextEffort, resolved.resolution);
  return {
    table: args.shown.map((item) => (item.name === profile ? row : item)),
    judgement: {
      ...judgement,
      ...(nextEffort !== entry.effort ? { escalated: true, effort: nextEffort } : {}),
      alternatives: choice.alternatives,
    },
  };
};

const judgeAndEscalate = (args: JudgePassInput) =>
  Effect.gen(function* () {
    const raw = yield* ask(judgeFor(args.ctx, args.tables), args.input.task, args.input.profile);
    if (raw.status !== "used") return { table: [...args.shown], judgement: raw };
    const escalated = escalateChoice(args, raw);
    const base = escalated?.judgement ?? raw;
    const table = escalated?.table ?? [...args.shown];
    const alternatives = (base.alternatives ?? []).filter((one) => one.profile !== base.profile);
    return { table, judgement: { ...base, alternatives } };
  });

const sessionCandidate = (
  models: ReadonlyArray<Model.Info>,
  modelRef: string,
): Candidate | undefined => {
  const foundModel = models
    .map(known)
    .find(
      (one) =>
        `${one.providerID}/${one.id}` === modelRef &&
        one.enabled &&
        one.status !== "deprecated" &&
        one.tools,
    );
  if (foundModel === undefined) return undefined;
  const alias = proposeAlias(foundModel, []);
  return candidates([{ alias, ref: modelRef, pinned: undefined }], [foundModel]).kept[0];
};

const resolveSessionDefaults = (args: {
  readonly ctx: Plugin.Context;
  readonly directory: string;
  readonly modelRef: string | undefined;
  readonly tables: Tables;
  readonly input: { readonly task?: string | undefined; readonly profile?: string | undefined };
}) =>
  Effect.gen(function* () {
    if (args.modelRef === undefined) return undefined;
    const listed = yield* hostCatalogue(args.ctx);
    const candidate = sessionCandidate(listed.models, args.modelRef);
    if (candidate === undefined) return undefined;
    const modelLadder = ladder(candidate.model);
    const clamp = (effort: string | undefined) => clampEffort(modelLadder, effort);
    const profiles: Readonly<Record<string, ProfileSpec>> = Object.fromEntries(
      Object.entries(DEFAULT_PROFILES).map(([name, entry]) => [
        name,
        { ...entry, crosscheck: undefined, effort: clamp(entry.effort) },
      ]),
    );
    const defaultShown = Object.entries(profiles).flatMap(([name, entry]) => {
      const one = resolve(
        name,
        { ...entry, effort: entry.effort ?? "none" },
        [candidate],
        DEFAULT_AGENT,
        [],
      );
      return one.resolution === undefined
        ? []
        : [toProfileRow(name, entry.match, entry.effort, one.resolution)];
    });
    const { table, judgement } = yield* judgeAndEscalate({
      ctx: args.ctx,
      tables: { ...args.tables, crosscheck: [], profiles },
      shown: defaultShown,
      kept: [candidate],
      input: args.input,
      clamp,
    });
    return {
      output: {
        status: "resolved" as const,
        profiles:
          args.input.profile === undefined
            ? table
            : table.filter((one) => one.name === args.input.profile),
        models: [asRow(candidate, 1)],
        crosscheck: [],
        sources: [],
        asked: args.input.profile === undefined ? [] : [args.input.profile],
        judge: judgement,
        warnings: [
          `No ${FILE_NAME} found in ${args.directory} — using defaults from current session model.`,
        ],
      },
    };
  });

export const routing = (ctx: Plugin.Context): Tool.Info<typeof Input, typeof Output> => ({
  name: "routing",
  description: DESCRIPTION,
  input: Input,
  output: Output,
  options: {
    namespace: "spectre",
    codemode: true,
    permission: "read",
  },
  execute: (input, context) =>
    Effect.gen(function* () {
      const state = yield* sessionState(ctx, context.sessionID);
      const { directory } = state;
      if (directory === undefined)
        return failed([
          `the session ${context.sessionID} could not be read, so the directory that holds its ${FILE_NAME} is unknown`,
        ]);
      const path = yield* writePath(directory);

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

      const unconfigured =
        (yield* inheritedConfigPath(directory)) === undefined &&
        found.tables.setup === undefined &&
        Object.keys(found.tables.models).length === 0 &&
        !found.configuredProfiles;
      if (unconfigured && input.setup === undefined) {
        const fallback = yield* resolveSessionDefaults({
          ctx,
          directory,
          modelRef: state.modelRef,
          tables: found.tables,
          input,
        });
        if (fallback !== undefined) return fallback;
        const set = yield* starter;
        if (set.problem !== undefined) return failed([set.problem]);
        if (set.file === undefined) return failed([`${path}: the starter set could not be read`]);
        return {
          output: {
            status: "setup",
            provider: set.file.provider,
            models: rows(set.file.models, set.file.priority),
            profiles: starterProfiles(set.file.profiles),
            source: path,
          },
        };
      }

      if (found.tables.setup !== undefined)
        return {
          output: {
            status: "declined",
            source: found.tables.setup.from,
          },
        };

      const listed = yield* hostCatalogue(ctx);
      const checked = check(
        found.configuredProfiles ? found.tables : { ...found.tables, profiles: {} },
        listed.models,
        DEFAULT_AGENT,
        agentIds,
      );
      const ordered = priorityOf(found.tables.models, found.tables.priority);
      const allowed = ordered.ranked.map((one) => ({
        alias: one.alias,
        ref: one.ref,
        pinned: undefined,
      }));
      const rankOf = new Map(ordered.ranked.map((one) => [one.alias, one.priority]));
      const kept = candidates(allowed, listed.models.map(known));

      const modelRows = kept.kept.map((one) => asRow(one, rankOf.get(one.alias) ?? 0));
      const crosscheckOrder = crosscheckOf(
        found.tables.models,
        found.tables.crosscheck,
        ordered.ranked.map((one) => one.alias),
      );
      const byAlias = new Map(kept.kept.map((one) => [one.alias, one]));
      const crosscheckRows = crosscheckOrder.listed.flatMap((alias) => {
        const one = byAlias.get(alias);
        return one === undefined ? [] : [asRow(one, rankOf.get(alias) ?? 0)];
      });

      const modelsValid =
        found.problems.length === 0 &&
        listed.problem === undefined &&
        ordered.problems.length === 0 &&
        checked.models.length === Object.keys(found.tables.models).length &&
        kept.missing.length === 0 &&
        allowed.length > 0;
      const crosscheckValid = modelsValid && crosscheckOrder.problems.length === 0;
      const failedWithOrder = (lines: ReadonlyArray<string>): { output: Page } =>
        failed(
          lines,
          modelsValid ? modelRows : undefined,
          crosscheckValid ? crosscheckRows : undefined,
        );

      const lines = [...found.problems];
      if (listed.problem !== undefined) lines.push(listed.problem);
      lines.push(...checked.problems);
      if (lines.length === 0 && kept.missing.length > 0)
        lines.push(...kept.missing.map((one) => `models.${one.alias}: ${one.reason}`));
      if (lines.length === 0 && allowed.length === 0)
        lines.push(`${FILE_NAME}: models is empty, so no model routes`);
      if (lines.length > 0) return failedWithOrder(lines);

      const shown: Array<typeof Profile.Type> = [];
      const profileProblems: Array<string> = [];
      for (const [name, entry] of Object.entries(found.tables.profiles)) {
        const one = resolve(name, entry, kept.kept, DEFAULT_AGENT, found.tables.crosscheck);
        if (one.problem !== undefined) {
          profileProblems.push(one.problem);
          continue;
        }
        if (one.resolution === undefined) continue;
        shown.push(toProfileRow(name, entry.match, entry.effort, one.resolution));
      }
      if (found.configuredProfiles || shown.length === 0) lines.push(...profileProblems);
      if (lines.length > 0) return failedWithOrder(lines);

      const { table, judgement } = yield* judgeAndEscalate({
        ctx,
        tables: found.tables,
        shown,
        kept: kept.kept,
        input,
      });

      return {
        output: {
          status: "resolved",
          profiles:
            input.profile === undefined ? table : table.filter((one) => one.name === input.profile),
          models: modelRows,
          crosscheck: crosscheckRows,
          sources: [...found.sources],
          asked: input.profile === undefined ? [] : [input.profile],
          judge: judgement,
        },
      };
    }),
});

export { candidates, isFree, known, ladder } from "./catalogue";
export { clampEffort, effortOf, fit, KNOWN_ORDER, ladderOf, rungs } from "./effort";
export { hostCatalogue, sessionState } from "./host";
export type { Decide, JevSettings } from "./jev";
export { DEFAULT_TIMEOUT_MS, JEV_MODEL, jevJudge, judgeRef } from "./jev";
export type { Description, Judge, Verdict } from "./judge";
export { lexicalJudge, rank, surface } from "./judge";
export { load, loadProject } from "./load";
export { FILE_NAME, inheritedConfigPath, LEGACY_NAME, writePath } from "./locate";
export type { CrosscheckOrder, Ordered, Ranked } from "./order";
export { crosscheckOf, priorityOf } from "./order";
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
export { DEFAULT_AGENT, DEFAULT_PROFILES, formatRef, isDefaultProfile, modelNames } from "./types";
export { proposeAlias, serialise, writeConfig } from "./write";
