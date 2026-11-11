import type { Plugin } from "@opencode/plugin/effect";
import type { Tool } from "@opencode/schema/tool";
import { Effect, Schema } from "effect";
import { candidates } from "./catalogue";
import { hostCatalogue, sessionDirectory } from "./host";
import { load } from "./load";
import { FILE_NAME } from "./locate";
import { priorityOf } from "./order";

/**
 * The model preference order, as one answer.
 *
 * The resolver reads the allowlist in the order `priority` states. This tool
 * exists so a session can ask what that order is without resolving a profile:
 * every model, its place, and the catalogue facts behind it. The model that
 * comes first and meets a profile's requirement is the one the resolver spends.
 */

const Input = Schema.Struct({});

const Row = Schema.Struct({
  priority: Schema.Number,
  alias: Schema.String,
  ref: Schema.String,
  family: Schema.optional(Schema.String),
  rungs: Schema.Array(Schema.String),
  cost: Schema.Struct({ input: Schema.Number, output: Schema.Number }),
});

const Resolved = Schema.Struct({
  status: Schema.Literals(["resolved"]),
  models: Schema.Array(Row),
  sources: Schema.Array(Schema.String),
});

const Problems = Schema.Struct({
  status: Schema.Literals(["problems"]),
  problems: Schema.String,
});

const Output = Schema.Union([Resolved, Problems]);

type Page = typeof Output.Type;

/** The output a test or the page names. */
export type PreferencePage = Page;

const failed = (lines: ReadonlyArray<string>): { output: Page } => ({
  output: { status: "problems", problems: lines.join("\n") },
});

const DESCRIPTION = `Return the model preference order: every model in the allowlist, the priority it holds, and the catalogue facts behind it.

The resolver spends the first model in this order that meets a profile's requirement. The order is the \`priority\` array in \`spectre.json\`, never the order the \`models\` object happens to have in the file. This tool is read-only; the routing page writes the order.

  { status: "resolved", models: [{ priority, alias, ref, family, rungs, cost }], sources }

A model the config lists but the catalogue cannot see, a priority that names no model, a model missing from \`priority\`, or a duplicate is a \`problems\` answer. Read \`sources\` to see which files were read.`;

export const routingModelPreference = (
  ctx: Plugin.Context,
): Tool.Info<typeof Input, typeof Output> => ({
  name: "routing_model_preference",
  description: DESCRIPTION,
  input: Input,
  output: Output,
  options: {
    namespace: "spectre",
    codemode: true,
    pinned: true,
    permission: "read",
  },
  execute: (_input, context) =>
    Effect.gen(function* () {
      const directory = yield* sessionDirectory(ctx, context.sessionID);
      if (directory === undefined)
        return failed([
          `the session ${context.sessionID} could not be read, so the directory that holds its ${FILE_NAME} is unknown`,
        ]);

      const found = yield* load(directory);
      if (found.problems.length > 0) return failed(found.problems);
      if (found.sources.length === 0)
        return failed([`${FILE_NAME}: routing is not configured, so there is no model preference`]);

      const ordered = priorityOf(found.tables.models, found.tables.priority);
      if (ordered.problems.length > 0) return failed(ordered.problems);
      if (ordered.ranked.length === 0)
        return failed([`${FILE_NAME}: models is empty, so there is no model preference`]);

      const listed = yield* hostCatalogue(ctx);
      const lines: Array<string> = [];
      if (listed.problem !== undefined) lines.push(listed.problem);

      const kept = candidates(
        ordered.ranked.map((one) => ({ alias: one.alias, ref: one.ref, pinned: undefined })),
        listed.models,
      );
      if (kept.missing.length > 0)
        lines.push(...kept.missing.map((one) => `models.${one.alias}: ${one.reason}`));
      if (lines.length > 0) return failed(lines);

      return {
        output: {
          status: "resolved" as const,
          models: kept.kept.map((one, at) => ({
            priority: at + 1,
            alias: one.alias,
            ref: one.ref,
            family: one.model.family,
            rungs: [...one.model.rungs],
            cost: { input: one.model.costInput, output: one.model.costOutput },
          })),
          sources: [...found.sources],
        },
      };
    }),
});
