import type { Plugin } from "@opencode/plugin/effect";
import type { Tool } from "@opencode/schema/tool";
import { Effect, Schema } from "effect";
import type { ParsedFile } from "./parse";
import type { CrossCheck, Input as ReadInput, Subject } from "./read";
import { read, run, totalsOf } from "./read";
import type { EvidenceRow } from "./store";
import {
  canvasDirectory,
  canvasFile,
  list as listStored,
  present as presentStored,
  save as saveStored,
  slugProblem,
  treeOf,
  writeEvidence,
} from "./store";

const Save = Schema.Struct({
  action: Schema.Literals(["save"]).annotate({
    description: "Allocate a canvas directory and return the path to write the page at.",
  }),
  slug: Schema.String.annotate({
    description:
      "Lowercase kebab-case name for this canvas, at most 40 characters. It is the identity: `save` is idempotent on it, so the reader asks again and gets the same file.",
  }),
});

const Diff = Schema.Struct({
  action: Schema.Literals(["diff"]).annotate({
    description:
      "Read a pull request, or an explicit local base and head, into evidence files. Line numbers and counts are computed here, not estimated by the reader.",
  }),
  slug: Schema.String.annotate({
    description:
      "Lowercase kebab-case name for the canvas this diff is evidence for. Prefix a pull request with `pr-<number>-`.",
  }),
  pr: Schema.optional(Schema.Number).annotate({
    description: "Pull request number. Names a pull request in the repository this was called in.",
  }),
  url: Schema.optional(Schema.String).annotate({
    description: "Pull request URL, for when the number alone would not say which repository.",
  }),
  base: Schema.optional(Schema.String).annotate({
    description: "Base ref of a local diff. Requires `head`. Neither ref is inferred.",
  }),
  head: Schema.optional(Schema.String).annotate({
    description: "Head ref of a local diff. Requires `base`. Neither ref is inferred.",
  }),
});

const List = Schema.Struct({
  action: Schema.optional(Schema.Literals(["list"])).annotate({
    description: "Inventory saved canvases. The default when `action` is omitted.",
  }),
});

const Present = Schema.Struct({
  action: Schema.Literals(["present"]).annotate({
    description: "Open a saved canvas with the operating system's launcher. There is no fallback.",
  }),
  id: Schema.String.annotate({
    description:
      "The slug `save` returned. Not a path: a canvas is named by the directory it was allocated in.",
  }),
});

const Input = Schema.Union([Save, Diff, List, Present]);

const PullRequestSubject = Schema.Struct({
  kind: Schema.Literals(["pull-request"]),
  number: Schema.Number,
  repository: Schema.String,
  url: Schema.String,
  title: Schema.String,
  author: Schema.String,
  state: Schema.Literals(["open", "closed", "merged"]),
  headSha: Schema.String,
  baseRef: Schema.String,
  headRef: Schema.String,
  additions: Schema.Number,
  deletions: Schema.Number,
  changedFiles: Schema.Number,
  isDraft: Schema.Boolean,
  body: Schema.String,
});

const LocalDiffSubject = Schema.Struct({
  kind: Schema.Literals(["local-diff"]),
  base: Schema.String,
  head: Schema.String,
  headSha: Schema.String,
});

const Totals = Schema.Struct({
  files: Schema.Number,
  additions: Schema.Number,
  deletions: Schema.Number,
});

const Cross = Schema.Union([
  Schema.Struct({ kind: Schema.Literals(["matched"]), parsed: Totals, reported: Totals }),
  Schema.Struct({
    kind: Schema.Literals(["mismatched"]),
    parsed: Totals,
    reported: Totals,
    why: Schema.String,
  }),
  Schema.Struct({ kind: Schema.Literals(["no-oracle"]), parsed: Totals, why: Schema.String }),
]);

const FileRow = Schema.Union([
  Schema.Struct({
    status: Schema.Literals(["read"]),
    index: Schema.Number,
    path: Schema.String,
    additions: Schema.Number,
    deletions: Schema.Number,
    evidence: Schema.String,
  }),
  Schema.Struct({
    status: Schema.Literals(["unreadable"]),
    index: Schema.Number,
    path: Schema.String,
    reason: Schema.String,
    evidence: Schema.String,
  }),
]);

const Stored = Schema.Struct({
  id: Schema.String,
  directory: Schema.String,
  canvas: Schema.String,
});

const Output = Schema.Union([
  Schema.Struct({ status: Schema.Literals(["saved"]), ...Stored.fields }),
  Schema.Struct({
    status: Schema.Literals(["taken"]).annotate({
      description:
        "That slug is already allocated. Nothing was overwritten, and the page at the returned path is the one to edit.",
    }),
    ...Stored.fields,
  }),
  Schema.Struct({
    status: Schema.Literals(["read"]),
    ...Stored.fields,
    subject: Schema.Union([PullRequestSubject, LocalDiffSubject]),
    files: Schema.Array(FileRow),
    cross: Cross,
    problems: Schema.Array(Schema.String),
  }),
  Schema.Struct({
    status: Schema.Literals(["listed"]),
    canvases: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        canvas: Schema.String,
        title: Schema.optional(Schema.String),
      }),
    ),
  }),
  Schema.Struct({
    status: Schema.Literals(["opened"]),
    canvas: Schema.String,
    deadLinks: Schema.Array(Schema.String),
  }),
  Schema.Struct({
    status: Schema.Literals(["not-opened"]).annotate({
      description:
        "The launcher could not open it, or the page is not there. Report this with the path; nothing else will try.",
    }),
    canvas: Schema.String,
    why: Schema.String,
  }),
  Schema.Struct({ status: Schema.Literals(["refused"]), problem: Schema.String }),
]);

const DESCRIPTION = `Save, open and list standalone HTML pages that outlive the session that made them, and read a pull request's diff into evidence with the arithmetic done in code.

A canvas is a file, not a chat reply: the reader asks again in three turns and gets the same one, edited in place. It lives outside the project tree, so it is neither committed by accident nor left as untracked dirt.

  const saved = await tools.spectre.canvas({ action: "save", slug: "tool-registration" })
  // write saved.canvas with the \`write\` tool, then:
  await tools.spectre.canvas({ action: "present", id: "tool-registration" })

Write the page yourself, with \`write\`. A canvas is a designed document with inline CSS and JavaScript, and a page of markup carried inside a \`Schema.String\` is an escaping hazard.

## What each action owns

- \`save\` allocates one directory and returns the path. It refuses a taken slug rather than overwriting, so \`taken\` means edit the file already there.
- \`diff\` reads a pull request, or an explicit local base and head, and writes one evidence file per changed file plus an \`index.json\` manifest.
- \`list\` inventories the saved canvases, for finding one to edit or reopen.
- \`present\` spawns \`open\`, \`xdg-open\` or \`start\`. One delivery path, so \`opened\` means the page is on a screen.

## Why the diff is not a payload

\`diff\` returns an inventory, not the diff. Every changed file's rows — line numbers derived from the hunk headers, additions and deletions counted — are written under \`evidence/files/\` and read back with \`read\`. A 164-file pull request is a megabyte, and a diff handed over as prose is measured to come back wrong: \`gh pr diff --patch\` wraps the diff in a mail document whose commit message is full of \`-\` bullets, and counting those as deletions reports 18 deletions for a change that made 15, silently.

\`cross\` is the count check, and it is not decoration. \`matched\` means the parser's totals equal the ones \`gh\` reported. \`mismatched\` carries both and says what differed. \`no-oracle\` means there was nothing to check against — a local diff has no pull request to disagree with it — which is not a pass.

\`subject.kind\` decides what may be claimed. A \`pull-request\` carries a number, url, state and author. A \`local-diff\` has none of those fields at all, so it cannot be written up as a pull request that does not exist.

A file with no text rows comes back \`unreadable\` with a reason — binary, submodule, mode-only, or no hunks. Never an empty row list, because empty reads as "nothing changed here".

**\`problems\` is not empty when the head moved.** The analysed commit is pinned and read again after the diff, so a pull request that moved mid-gather says so rather than being described as one commit while the rows on the table are another.

## What it will not do

It does not truncate. Every changed file is written whole, and which paths the page left out is the page's own to confess in its limits section.

It does not write the page, edit one, or delete anything.

\`present\` never falls back to a browser tool. A canvas outlives its session, so delivering it through a session-scoped view ties a persistent artifact to a transient surface, and a page written but never shown reads as a bug in the code under test. \`not-opened\` is a real answer: report it with the path in hand.

\`deadLinks\` lists in-page anchors that resolve to no \`id\`. It is lexical and it is a start, not a link checker.`;

/**
 * `basename(project directory)`, and `basename(git rev-parse --show-toplevel)`
 * when the first is not a usable name. The git read is the fallback and costs a
 * spawn, so it runs only when the cheap answer failed.
 *
 * The collision this inherits is recorded in `features/data-root.md`: `main` is a
 * common worktree name and two repositories can each have one, so their canvas
 * stores merge. The fix belongs in that file, in the change that defines the
 * placeholder for every skill writing there.
 */
const treeName = async (projectDirectory: string): Promise<string | undefined> => {
  const named = treeOf(projectDirectory, undefined);
  if (named !== undefined) return named;
  const toplevel = await run(projectDirectory, ["git", "rev-parse", "--show-toplevel"]);
  return toplevel.ran && toplevel.code === 0 ? treeOf(projectDirectory, toplevel.out) : undefined;
};

const unnamed = (directory: string): string =>
  `${directory} has no usable directory name, so no canvas could be allocated there`;

/**
 * Exactly one subject, named. Three flat optional fields admit five combinations
 * and four of them are wrong, so the narrowing happens once here and returns the
 * union `read` takes — no cast, and a refusal for each way of getting it wrong.
 */
const subjectOf = (
  input: typeof Diff.Type,
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

export const canvases = (ctx: Plugin.Context): Tool.Info<typeof Input, typeof Output> => ({
  name: "canvas",
  description: DESCRIPTION,
  input: Input,
  output: Output,
  options: { namespace: "spectre", codemode: true, pinned: true, permission: "canvas" },
  execute: (input) =>
    Effect.gen(function* () {
      const project = ctx.location.project.directory;
      const tree = yield* Effect.promise(() => treeName(project));
      if (tree === undefined)
        return { output: { status: "refused" as const, problem: unnamed(project) } };

      if (input.action === "present") {
        const invalid = slugProblem(input.id);
        if (invalid !== undefined)
          return { output: { status: "refused" as const, problem: `id: ${invalid}` } };
        const canvas = canvasFile(canvasDirectory(tree, input.id));
        return { output: yield* Effect.promise(() => presentStored(canvas, process.platform)) };
      }

      if (input.action !== "save" && input.action !== "diff")
        return {
          output: {
            status: "listed" as const,
            canvases: yield* Effect.promise(() => listStored(tree)),
          },
        };

      const invalid = slugProblem(input.slug);
      if (invalid !== undefined)
        return { output: { status: "refused" as const, problem: invalid } };

      const allocated = yield* Effect.promise(() => saveStored(tree, input.slug));
      if (allocated.status === "refused")
        return { output: { status: "refused" as const, problem: allocated.why } };

      const directory = allocated.directory;
      const stored = { id: input.slug, directory, canvas: canvasFile(directory) };

      if (input.action === "save") return { output: { status: allocated.status, ...stored } };

      const subject = subjectOf(input);
      if (!subject.ok) return { output: { status: "refused" as const, problem: subject.problem } };

      const gathered = yield* Effect.promise(() => read(ctx.location.directory, subject.input));
      if (gathered.status === "refused")
        return { output: { status: "refused" as const, problem: gathered.problem } };

      const manifest = manifestOf(
        gathered.subject,
        gathered.cross,
        gathered.problems,
        gathered.files,
      );
      const files: ReadonlyArray<EvidenceRow> = yield* Effect.promise(() =>
        writeEvidence(directory, manifest, gathered.files),
      );

      return {
        output: {
          status: "read" as const,
          ...stored,
          subject: gathered.subject,
          files,
          cross: gathered.cross,
          problems: gathered.problems,
        },
      };
    }),
});

const manifestOf = (
  subject: Subject,
  cross: CrossCheck,
  problems: ReadonlyArray<string>,
  files: ReadonlyArray<ParsedFile>,
) => ({ subject, cross, totals: totalsOf(files), problems });
