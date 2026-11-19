import { appendFile, mkdir } from "node:fs/promises";
import type { Plugin, Tool } from "@opencode/plugin/effect";
import { Effect, Schema } from "effect";
import { sessionState } from "./host";

/**
 * The outcome ledger.
 *
 * The router is read-only and cannot observe what happened after it named a
 * profile. The session can. This tool appends one JSON line per run to
 * `.spectre/routing.jsonl`, so profile selection can be measured on real
 * traffic instead of only on the blind corpus.
 *
 * It records the session's claim, not a verification. An `accepted` outcome is
 * the session saying the result stood; a `revised` outcome is the session
 * saying the child had to redo it. The label is only as good as the session
 * that writes it.
 */

const Input = Schema.Struct({
  profile: Schema.String.annotate({ description: "The profile the router chose." }),
  model: Schema.String.annotate({ description: "The model ref the resolver spent." }),
  outcome: Schema.Literals(["accepted", "revised", "failed", "unknown"]).annotate({
    description:
      "What happened to the result. `accepted` stood, `revised` needed a follow-up, `failed` did not land, `unknown` is the honest default.",
  }),
  confidence: Schema.optional(Schema.Number).annotate({
    description: "The judge's confidence, when it reported one.",
  }),
  task: Schema.optional(Schema.String).annotate({
    description: "The task statement, when the caller wants the ledger to be readable.",
  }),
  note: Schema.optional(Schema.String).annotate({
    description: "One line on what went wrong or right.",
  }),
});

const Recorded = Schema.Struct({
  status: Schema.Literals(["recorded"]),
  /** The ledger file the line was appended to. */
  path: Schema.String,
});

const Refused = Schema.Struct({
  status: Schema.Literals(["refused"]),
  problem: Schema.String,
});

const Output = Schema.Union([Recorded, Refused]);

export type FeedbackPage = typeof Output.Type;

const text = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

const DESCRIPTION = `Record what happened after a routed run, so the profile choice can be measured.
Appends one JSON line (profile, model, outcome, optional confidence) to \`.spectre/routing.jsonl\` under the session's directory. Call it once after the work ends; the outcome is the session's own label, not a measurement.`;

export const routingFeedback = (ctx: Plugin.Context): Tool.Info<typeof Input, typeof Output> => ({
  name: "routing_feedback",
  description: DESCRIPTION,
  input: Input,
  output: Output,
  options: {
    namespace: "spectre",
    codemode: true,
    permission: "write",
  },
  execute: (input, context) =>
    Effect.gen(function* () {
      const state = yield* sessionState(ctx, context.sessionID);
      const { directory } = state;
      if (directory === undefined)
        return {
          output: {
            status: "refused" as const,
            problem: `the session ${context.sessionID} could not be read, so the ledger has no directory`,
          },
        };

      const folder = `${directory}/.spectre`;
      const path = `${folder}/routing.jsonl`;
      const record = {
        at: new Date().toISOString(),
        profile: input.profile,
        model: input.model,
        outcome: input.outcome,
        ...(input.confidence === undefined ? {} : { confidence: input.confidence }),
        ...(input.task === undefined ? {} : { task: input.task }),
        ...(input.note === undefined ? {} : { note: input.note }),
      };

      return yield* Effect.tryPromise({
        try: async () => {
          await mkdir(folder, { recursive: true });
          await appendFile(path, `${JSON.stringify(record)}\n`, "utf8");
          return { status: "recorded" as const, path };
        },
        catch: (cause) => cause,
      }).pipe(
        Effect.map((recorded) => ({ output: recorded })),
        Effect.catch((cause) =>
          Effect.succeed({
            output: { status: "refused" as const, problem: text(cause) },
          }),
        ),
      );
    }),
});
