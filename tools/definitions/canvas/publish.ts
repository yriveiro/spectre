import { Artifact, type Plugin } from "@opencode/plugin/effect";
import type { Tool } from "@opencode/schema/tool";
import { Effect, Schema } from "effect";

/**
 * The only module that reaches the host's artifact tools. It resolves them from
 * the live registry at call time, so a flag change is respected without a
 * restart, and it maps every outcome to a value the canvas tool can report.
 *
 * `unavailable` is the flag-off path and `failed` is a host or provider error.
 * They stay separate because the fix differs: one is configuration, the other
 * is a bug or a provider problem.
 */
export type Publication =
  | {
      readonly status: "published";
      readonly id: string;
      readonly url: string;
      readonly provider: string;
      readonly title: string;
    }
  | { readonly status: "unavailable"; readonly problem: string }
  | { readonly status: "failed"; readonly problem: string };

const unavailableProblem =
  "artifacts are off, so nothing was published. " +
  "The artifact tools are registered only when `experimental.artifacts` is true in opencode.json, " +
  "or when OPENCODE_FLAGS=artifacts. `diff` still works, and the page can be published after the flag is on.";

type RegistryTool = Tool.Info & { readonly id: string };

const findArtifactTool = (
  ctx: Plugin.Context,
  name: "artifact_create" | "artifact_update",
): Effect.Effect<RegistryTool | undefined> =>
  Effect.map(ctx.tool.list(), (tools) =>
    tools.find((tool) => tool.name === name && tool.options?.namespace === "opencode"),
  );

const hasMessage = (value: unknown): value is { readonly message: string } => {
  if (typeof value !== "object" || value === null) return false;
  if (!("message" in value)) return false;
  return typeof value.message === "string";
};

const messageOf = (error: unknown): string => (hasMessage(error) ? error.message : String(error));

/**
 * The raw `execute` returns the core `Artifact.Info` as its output. A decode
 * failure is `failed`, not a success with missing fields, and an empty `url`
 * is `failed`: the canvas tool reports an id and a URL it can stand behind, or
 * it reports nothing. The title is the host's, not the requested one.
 */
const toPublished = (output: unknown): Publication => {
  const decoded = Schema.decodeUnknownOption(Artifact.Info)(output);
  if (decoded._tag === "None") {
    return {
      status: "failed",
      problem: "the artifact tool returned an output that is not an Artifact.Info.",
    };
  }
  const info = decoded.value;
  if (info.url.length === 0) {
    return { status: "failed", problem: "the artifact tool returned an empty url." };
  }
  return {
    status: "published",
    id: info.id,
    url: info.url,
    provider: info.provider,
    title: info.title,
  };
};

type RunOutcome =
  | { readonly ok: true; readonly value: Publication }
  | { readonly ok: false; readonly problem: string };

/**
 * Run one artifact tool call. The in-process `execute` skips the artifact
 * tool's own `execute.before/after` hooks; the canvas tool's own permission is
 * the gate. A `Tool.Error` from the host keeps its message in `failed`.
 */
const run = Effect.fn("Canvas.artifact.run")(function* (
  tool: RegistryTool,
  input: Record<string, unknown>,
  context: Tool.Context,
) {
  const outcome: RunOutcome = yield* tool.execute(input, context).pipe(
    Effect.map((result): RunOutcome => ({ ok: true, value: toPublished(result.output) })),
    Effect.catch(
      (error): Effect.Effect<RunOutcome> =>
        Effect.succeed({ ok: false, problem: messageOf(error) }),
    ),
  );
  if (!outcome.ok) return { status: "failed", problem: outcome.problem } satisfies Publication;
  return outcome.value;
});

export type CreateInput = {
  readonly ctx: Plugin.Context;
  readonly context: Tool.Context;
  readonly title: string;
  readonly files: Readonly<Record<string, string>>;
};

export type UpdateInput = CreateInput & { readonly id: string };

export const create = Effect.fn("Canvas.artifact.create")(function* (input: CreateInput) {
  const tool = yield* findArtifactTool(input.ctx, "artifact_create");
  if (tool === undefined)
    return { status: "unavailable", problem: unavailableProblem } satisfies Publication;
  return yield* run(
    tool,
    { title: input.title, files: input.files, entry: "index.html", provider: "local" },
    input.context,
  );
});

export const update = Effect.fn("Canvas.artifact.update")(function* (input: UpdateInput) {
  const tool = yield* findArtifactTool(input.ctx, "artifact_update");
  if (tool === undefined)
    return { status: "unavailable", problem: unavailableProblem } satisfies Publication;
  return yield* run(
    tool,
    { id: input.id, title: input.title, files: input.files, entry: "index.html" },
    input.context,
  );
});
