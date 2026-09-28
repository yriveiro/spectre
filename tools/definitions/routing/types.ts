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
 * Decoded with `onExcessProperty: "error"`, so a key nobody here knows is a
 * problem that names itself.
 */
export const Config = Schema.Struct({
  $schema: Schema.optional(Schema.String),
  models: Schema.optional(
    Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Null])),
  ),
  profiles: Schema.optional(
    Schema.Record(Schema.String, Schema.Union([Profile, Schema.Null])),
  ),
});

export type File = typeof Config.Type;
export type ProfileEntry = typeof Profile.Type;

export type Tables = {
  readonly models: Readonly<Record<string, string>>;
  readonly profiles: Readonly<
    Record<string, { model: ReadonlyArray<string>; why: string; agent?: string }>
  >;
};

/**
 * `Model.Ref` parses but does not format, and the `subagent` tool takes a string.
 */
export const formatRef = (ref: Model.Ref): string =>
  ref.variant === undefined
    ? `${ref.providerID}/${ref.id}`
    : `${ref.providerID}/${ref.id}#${ref.variant}`;

export const DEFAULT_AGENT = "spectre";
