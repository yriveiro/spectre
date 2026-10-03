import type { Model } from "@opencode/schema/model";
import { Schema } from "effect";

/** One model, or several in order of preference. */
const ModelNames = Schema.Union([Schema.String, Schema.Array(Schema.String)]);

const Profile = Schema.Struct({
  model: ModelNames,
  why: Schema.String,
  agent: Schema.optional(Schema.String),
});

/**
 * A path to the reader's own copy of the ASD-STE100 dictionary, as JSON.
 *
 * It is a path and not the words themselves. The standard restricts reproduction
 * of its dictionary to eight categories of organisation, so nothing in this
 * repository carries the word list. A `null` removes a path an earlier config
 * file set, which is why it is a union with null rather than a bare string.
 */
const Dictionary = Schema.Union([Schema.String, Schema.Null]);

/**
 * Decoded with `onExcessProperty: "error"`, so a key nobody here knows is a
 * problem that names itself.
 */
export const Config = Schema.Struct({
  $schema: Schema.optional(Schema.String),
  models: Schema.optional(Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Null]))),
  profiles: Schema.optional(Schema.Record(Schema.String, Schema.Union([Profile, Schema.Null]))),
  dictionary: Schema.optional(Dictionary),
});

export type File = typeof Config.Type;
export type ProfileEntry = typeof Profile.Type;

export type Tables = {
  readonly models: Readonly<Record<string, string>>;
  readonly profiles: Readonly<
    Record<string, { model: ReadonlyArray<string>; why: string; agent?: string }>
  >;
  /** The configured path, resolved against the config file that set it, or absent. */
  readonly dictionary?: { readonly path: string; readonly from: string };
};

/**
 * `Model.Ref` parses but does not format, and the `subagent` tool takes a string.
 */
export const formatRef = (ref: Model.Ref): string =>
  ref.variant === undefined
    ? `${ref.providerID}/${ref.id}`
    : `${ref.providerID}/${ref.id}#${ref.variant}`;

export const DEFAULT_AGENT = "spectre";
