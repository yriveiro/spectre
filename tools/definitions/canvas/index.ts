import type { Plugin, Tool } from "@opencode/plugin/effect";
import { Effect } from "effect";
import { diagram, page, report } from "./compose";
import {
  type Composed,
  type Content,
  type DiffInput,
  Input,
  type Input as InputType,
  Output,
  refused,
} from "./content";
import { bundle } from "./d3";
import { load, write } from "./evidence";
import { pr as composePr } from "./pr";
import { create, update } from "./publish";
import type { Read, Input as ReadInput } from "./read";
import { read as readDiff, totalsOf } from "./read";

const DESCRIPTION = `Publish or update interactive HTML pages, Mermaid diagrams, Markdown reports, and visual PR reviews as artifacts.
Use action "diff" to parse a pull request or local base and head diff into cached evidence with a token, "publish" to create an OpenCode artifact URL (with bundled d3.min.js for custom UI pages and static SVG Mermaid rendering), and "update" to replace an existing art_ artifact in place.`;

const subjectOf = (
  input: DiffInput,
):
  | { readonly ok: true; readonly input: ReadInput }
  | { readonly ok: false; readonly problem: string } => {
  if (input.pr !== undefined) return { ok: true, input: { pr: input.pr } };
  if (input.url !== undefined) return { ok: true, input: { url: input.url } };
  if (input.base === undefined && input.head === undefined)
    return {
      ok: false,
      problem:
        "a diff needs one of `pr`, `url`, or `base` with `head`; none is inferred from the branch",
    };
  if (input.base === undefined || input.head === undefined)
    return { ok: false, problem: "a local diff needs both `base` and `head`; neither is inferred" };
  return { ok: true, input: { base: input.base, head: input.head } };
};

const bytesOf = (files: Readonly<Record<string, string>>): number => {
  const encoder = new TextEncoder();
  return Object.values(files).reduce((total, file) => total + encoder.encode(file).byteLength, 0);
};

const causeMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

/**
 * Turn a rejecting promise into a value the tool can report. The filesystem and
 * the installed d3 bundle are outside the program, so a rejection is a refusal,
 * never a defect that reaches the host as a crash.
 */
const attempt = <A>(
  run: () => Promise<A>,
): Effect.Effect<
  { readonly ok: true; readonly value: A } | { readonly ok: false; readonly problem: string }
> =>
  Effect.tryPromise({ try: run, catch: causeMessage }).pipe(
    Effect.map((value) => ({ ok: true as const, value })),
    Effect.catch((problem: string) => Effect.succeed({ ok: false as const, problem })),
  );

/**
 * Compose one content arm. The switch is exhaustive: a new content kind fails
 * the build at the `never`, so it cannot fall through to a diagram by accident.
 */
const buildContent = (project: string, content: Content): Effect.Effect<Composed> =>
  Effect.gen(function* () {
    switch (content.kind) {
      case "pr": {
        const evidence = yield* Effect.promise(() => load(project, content.token));
        if (evidence === undefined)
          return {
            ok: false as const,
            problem: `no evidence for token ${content.token}; run \`diff\` again and use the token it returns`,
          };
        return composePr(evidence, content.review);
      }
      case "page": {
        const built = yield* attempt(() => page(content, bundle));
        return built.ok ? built.value : { ok: false as const, problem: built.problem };
      }
      case "report":
        return report(content);
      case "diagram":
        return diagram(content);
      default: {
        const _exhaustive: never = content;
        return _exhaustive;
      }
    }
  });

export const canvases = (ctx: Plugin.Context): Tool.Info<typeof Input, typeof Output> => ({
  name: "canvas",
  description: DESCRIPTION,
  input: Input,
  output: Output,
  options: { namespace: "spectre", codemode: true, permission: "canvas" },
  execute: Effect.fn("Canvas.execute")(function* (input: InputType, context: Tool.Context) {
    const project = ctx.location.project.directory;
    const cwd = ctx.location.directory;

    if (input.action === "diff") {
      const subject = subjectOf(input);
      if (!subject.ok) return { output: refused(subject.problem) };

      const read: Read = yield* Effect.promise(() => readDiff(cwd, subject.input));
      if (read.status === "refused") return { output: refused(read.problem) };

      const wrote = yield* attempt(() => write(project, read));
      if (!wrote.ok) return { output: refused(wrote.problem) };

      return {
        output: {
          status: "read" as const,
          token: wrote.value.token,
          subject: read.subject,
          totals: totalsOf(read.files),
          cross: read.cross,
          files: wrote.value.rows,
          warnings: read.problems,
        },
      };
    }

    if (input.action === "update" && !input.id.startsWith("art_"))
      return { output: refused("update id must be an artifact id that starts with `art_`") };

    const built: Composed = yield* buildContent(project, input.content);
    if (!built.ok) return { output: refused(built.problem) };

    const publication =
      input.action === "update"
        ? yield* update({
            ctx,
            context,
            id: input.id,
            title: built.title,
            files: built.files,
          })
        : yield* create({ ctx, context, title: built.title, files: built.files });

    if (publication.status !== "published") return { output: refused(publication.problem) };

    return {
      output: {
        status: "published" as const,
        id: publication.id,
        url: publication.url,
        provider: publication.provider,
        title: publication.title,
        bytes: bytesOf(built.files),
        warnings: [...built.warnings],
      },
    };
  }),
});
