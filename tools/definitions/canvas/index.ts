import type { Plugin } from "@opencode/plugin/effect";
import type { Tool } from "@opencode/schema/tool";
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

const DESCRIPTION = `Publish a canvas as an OpenCode artifact, or read a pull request into evidence for a review canvas.

A canvas is an artifact, not a chat reply: the reader gets an id and a durable URL, asks again in three turns, and the same artifact is updated in place. Publishing needs experimental.artifacts in opencode.json; when the flag is off the publish actions refuse and name it.

## What each action owns

- \`diff\` reads a pull request, or an explicit local base and head, and writes the parsed rows to a scratch cache. It returns a token, the subject, the totals and the count cross-check. The token is the input to a \`pr\` content and is content-addressed, so reading the same diff twice gives the same token.
- \`publish\` creates a new artifact. A second publish is a second artifact.
- \`update\` replaces the whole file map at the same artifact id and URL. It needs the id \`publish\` returned; there is no list.

## Content kinds

- \`report\` takes Markdown. Mermaid fences are rendered to static SVG at publish time with Pele. Code owns the page, the escaping, the headings and the table of contents.
- \`diagram\` takes one Mermaid source and a one-sentence takeaway. It is the one-figure page; several figures belong in a report.
- \`page\` takes one complete HTML document. This is the designed-page arm: keep CSS and JavaScript inline, and reference \`vendor/d3.min.js\` when the page needs d3. The tool attaches the installed d3 bundle.
- \`pr\` takes the token from \`diff\` and a typed review. The code validates every cited path and line against the parsed rows, renders the diff, and leaves the story to the review.

## What it will not do

It does not present a page with the OS launcher, and it cannot build an absolute URL: the result is the artifact id and the relative URL the host reported. Say that, and never claim the page opened. It does not enumerate artifacts; the id from \`publish\` is the handle.`;

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
  options: { namespace: "spectre", codemode: true, pinned: true, permission: "canvas" },
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
