import type { Model } from "@opencode/schema/model";
import { Schema } from "effect";

/**
 * The config file, and the tables it decodes into.
 *
 * A profile states a requirement, not a spend. `effort` is the requirement,
 * `model` is a pin that overrides it, and `match` is the routing surface. The
 * schema describes the file and it enforces nothing: the policy lives in
 * `check.ts`, which reports what the schema cannot express.
 */

/** One model, or several in order of preference. */
const ModelNames = Schema.Union([Schema.String, Schema.Array(Schema.String)]);

/** The second opinion: the effort it is asked for, and how it is chosen. */
const Crosscheck = Schema.Struct({
  effort: Schema.optional(Schema.String),
  prefer: Schema.optional(Schema.Literals(["free"])),
});
export type Crosscheck = typeof Crosscheck.Type;

const Profile = Schema.Struct({
  /** The thinking this task needs. A name from the catalogue, not a closed set. */
  effort: Schema.optional(Schema.String),
  /** A pin. It wins over `effort`. */
  model: Schema.optional(ModelNames),
  /** The second opinion, stated as a requirement. */
  crosscheck: Schema.optional(Crosscheck),
  /** The routing surface: the moment, with the nouns a prompt would carry. */
  match: Schema.optional(Schema.String),
  /** The rationale, for the human. The resolver never reads it. */
  why: Schema.optional(Schema.String),
  agent: Schema.optional(Schema.String),
});
export type ProfileEntry = typeof Profile.Type;

/**
 * A path to the reader's own copy of the ASD-STE100 dictionary, as JSON.
 *
 * It is a path and not the words themselves. The standard restricts reproduction
 * of its dictionary to eight categories of organisation, so nothing in this
 * repository carries the word list. A `null` removes a path an earlier config
 * file set, which is why it is a union with null rather than a bare string.
 */
/**
 * The judge: the model that answers which profile a task belongs to.
 *
 * Every field is optional, because a judge that names no endpoint has nowhere
 * to ask, and that is the same as no judge at all. The key is the name of an
 * environment variable, never the key itself, so the file holds no secret.
 */
const Judge = Schema.Struct({
  /** Which arm answers. The lexical one reads the surface; the System One one asks a model. */
  kind: Schema.optional(Schema.Literals(["lexical", "jev"])),
  /** The model to ask, such as `jev-1.13-free`. */
  model: Schema.optional(Schema.String),
  /** The endpoint to ask. The System One route answers at its own path. */
  endpoint: Schema.optional(Schema.String),
  /** The environment variable that holds the key. */
  key: Schema.optional(Schema.String),
  /** The budget for one question, in milliseconds. */
  timeout: Schema.optional(Schema.Int),
});
export type JudgeConfig = typeof Judge.Type;

const Dictionary = Schema.Union([Schema.String, Schema.Null]);

/**
 * Decoded with `onExcessProperty: "error"`, so a key nobody here knows is a
 * problem that names itself.
 */
export const Config = Schema.Struct({
  $schema: Schema.optional(Schema.String),
  /**
   * The stored answer to the setup question. `declined` says this repository
   * routes on no model, so the question does not come again. An accepted answer
   * writes the starter set itself, so it needs no marker.
   */
  setup: Schema.optional(Schema.Literals(["declined"])),
  /** The default provider the page opens with, and the starter set. */
  provider: Schema.optional(Schema.String),
  models: Schema.optional(Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Null]))),
  profiles: Schema.optional(Schema.Record(Schema.String, Schema.Union([Profile, Schema.Null]))),
  /**
   * The judge, when the file asks for one. `null` says no, and it removes a
   * judge's setting that an earlier file made.
   */
  judge: Schema.optional(Schema.Union([Judge, Schema.Null])),
  dictionary: Schema.optional(Dictionary),
});

export type File = typeof Config.Type;

/** A profile as the tables hold it: one model list, and the requirement beside it. */
export type Profile = {
  /** The thinking this task needs. */
  readonly effort?: string | undefined;
  /** A pinned model, as a list so the shape matches the file. */
  readonly model?: ReadonlyArray<string> | undefined;
  /** The second opinion, stated as a requirement. */
  readonly crosscheck?: Crosscheck | undefined;
  /** The routing surface. */
  readonly match?: string | undefined;
  /** The rationale, for the human. */
  readonly why?: string | undefined;
  /** The agent the run happens under. */
  readonly agent?: string | undefined;
};

export type Tables = {
  /** The configured default provider, or absent. */
  readonly provider: string | undefined;
  /** The judge the config asks for, or absent. */
  readonly judge: JudgeConfig | undefined;
  /**
   * The stored answer to the setup question, and the file that carries it. A
   * later file with no answer clears an earlier one, so a project config
   * overrides a decline written in the global file.
   */
  readonly setup?: { readonly from: string } | undefined;
  readonly models: Readonly<Record<string, string>>;
  readonly profiles: Readonly<Record<string, Profile>>;
  /** The configured path, resolved against the config file that set it, or absent. */
  readonly dictionary?: { readonly path: string; readonly from: string };
};

/** A candidate the allowlist names, before the catalogue is consulted. */
export type Allowed = {
  readonly alias: string;
  readonly ref: string;
  /** The variant the allowlist pinned, when it pinned one. */
  readonly pinned: string | undefined;
};

/** A model of the catalogue, read once and reduced to what a decision needs. */
export type Known = {
  readonly providerID: string;
  readonly id: string;
  readonly name: string;
  readonly family: string | undefined;
  /** The effort rungs the catalogue gives this model, in ladder order. */
  readonly rungs: ReadonlyArray<string>;
  readonly costInput: number;
  readonly costOutput: number;
  readonly enabled: boolean;
  readonly status: string;
  readonly tools: boolean;
};

/** A candidate: an alias, the model it names, and the rungs it can be asked for. */
export type Candidate = {
  readonly alias: string;
  readonly ref: string;
  readonly model: Known;
  /** The rung the allowlist pinned, when it pinned one. */
  readonly pinned: string | undefined;
};

/** The model one profile is spent on. */
export type Pick = {
  readonly alias: string;
  readonly ref: string;
  /** The rung asked for, when the model has one. */
  readonly rung: string | undefined;
  readonly pinned: boolean;
  /** True when the ladder had no rung at the requirement and stepped up. */
  readonly steppedUp: boolean;
  /** The rung below the one used, when there is one. */
  readonly below: string | undefined;
  readonly family: string | undefined;
  readonly rungs: ReadonlyArray<string>;
  readonly costInput: number;
  readonly costOutput: number;
};

/** A candidate that did not qualify, and how far it reaches. */
export type Excluded = {
  readonly alias: string;
  readonly ref: string;
  readonly reason: string;
  readonly rungs: ReadonlyArray<string>;
  /** The highest rung the model reaches, when it reaches one. */
  readonly reaches: string | undefined;
};

/** One profile, resolved. */
export type Resolution = {
  readonly profile: string;
  readonly agent: string;
  readonly primary: Pick;
  readonly crosscheck: Pick | undefined;
  /**
   * Why a declared crosscheck found no model, when it found none. A profile
   * that declares a second opinion and gets none says so, because a reader
   * cannot tell "no second opinion was asked for" from "the second opinion
   * could not be had" when both arrive as an absent field.
   */
  readonly crosscheckProblem: string | undefined;
  readonly excluded: ReadonlyArray<Excluded>;
};

/**
 * `Model.Ref` parses but does not format, and the `subagent` tool takes a string.
 */
export const formatRef = (ref: Model.Ref): string =>
  ref.variant === undefined
    ? `${ref.providerID}/${ref.id}`
    : `${ref.providerID}/${ref.id}#${ref.variant}`;

export const DEFAULT_AGENT = "spectre";
