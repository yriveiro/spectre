import type { Plugin } from "@opencode/plugin/effect";
import type { Model } from "@opencode/schema/model";
import type { Tool } from "@opencode/schema/tool";
import { Effect, Schema } from "effect";
import { agentIds } from "../../../agents";
import { check } from "./check";
import { load } from "./load";
import { FILE_NAME } from "./locate";
import { DEFAULT_AGENT } from "./types";

/**
 * Read per call, so a config edited mid-session routes on the edit. The schemas
 * stay inside the subset the sandbox boundary accepts, per `tools/FOR_AGENTS.md`.
 *
 * @see features/model-routing.md
 */

const Input = Schema.Struct({
  profile: Schema.optional(Schema.String).annotate({
    description: "One profile name, to get just that row. Omit it for the whole table.",
  }),
});

const Row = Schema.Struct({ name: Schema.String, model: Schema.String });

const Output = Schema.Struct({
  profiles: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      /** Every candidate, in the order the config lists them. */
      models: Schema.Array(Row),
      agent: Schema.String,
      why: Schema.String,
    }),
  ),
  models: Schema.Array(Row),
  sources: Schema.Array(Schema.String),
  /** Set when there is no usable table, one problem per line. */
  problems: Schema.optional(Schema.String),
});

/** Exported so a test can name it: `Tool.Info.output` is optional on the type. */
export type Page = typeof Output.Type;

const DESCRIPTION = `List the models this project allows you to spend on a subagent.
Every string here was checked a moment ago against the models this session can see.

This list is the whole vocabulary. A model that is not in it is not spendable on a
spectre subagent, however many models the provider offers, so never write a model
id from memory. If nothing here fits, say so and ask, rather than reaching for a
model outside the list.

How to use it: call this, pick a profile, pick one of its models, pass that string
through unchanged.

  const t = await tools.spectre.routing({})
  subagent({ agent: t.profiles[0].agent, prompt: "<the task>", model: t.profiles[0].models[0].model })

What comes back:

- \`profiles\`: the vocabulary. A name, one line on when to reach for it, the \`agent\`
  to spend it on, and \`models\`: the candidates, in the order the config lists them.
  Take the first that fits the task. If the task is plainly harder than the first
  candidate, take a later one and say which and why. Pass \`model\` exactly as given,
  including any variant suffix.
- \`models\`: every allowed model, for when no profile fits.
- \`agent\`: always a spectre agent, so the work runs in spectre mode. If a profile
  names one that is not, the tool reports it instead of routing.
- \`sources\`: the config files that were read.
- \`problems\`: set when there is no usable table. It lists every mistake at once
  and names the key that is wrong. If it is set, say routing is misconfigured and
  quote it, then ask whether to continue on the current model. Do not substitute a
  model you remember.

One case is not a preference. A literature, citation, or research task runs on the
strongest model in the table however simple the request reads: a cheap model
returns a clean, tidy bibliography whose references do not resolve, and nothing in
the text looks wrong, so a human reading the answer cannot catch it.`;

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
      const found = yield* load(ctx.location.directory);
      const listed = yield* catalogue(ctx);
      const checked = check(found.tables, listed.models, DEFAULT_AGENT, agentIds);

      const problems = [
        ...found.problems,
        ...(listed.problem === undefined ? [] : [listed.problem]),
        ...checked.problems,
      ];
      if (found.sources.length > 0 && Object.keys(found.tables.models).length === 0)
        problems.push(`${FILE_NAME}: no models are allowed, so nothing routes`);

      if (problems.length > 0)
        return {
          output: {
            profiles: [],
            models: [],
            sources: [...found.sources],
            problems: problems.join("\n"),
          },
        };

      return {
        output: {
          profiles:
            input.profile === undefined
              ? [...checked.profiles]
              : checked.profiles.filter((one) => one.name === input.profile),
          models: [...checked.models],
          sources: [...found.sources],
        },
      };
    }),
});
