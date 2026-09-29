import type { Tool } from "@opencode/schema/tool";
import { Effect, Schema } from "effect";
import { audit } from "./audit";
import { BUCKETS, count } from "./classify";

const Bucket = Schema.Literals([...BUCKETS]);

const Input = Schema.Struct({
  repo: Schema.optional(Schema.String).annotate({
    description: "Repository to inspect. Defaults to the project directory.",
  }),
});

const Row = Schema.Struct({
  path: Schema.String,
  branch: Schema.String,
  head: Schema.String,
  ageDays: Schema.Number,
  merged: Schema.Boolean,
  dirty: Schema.String,
  remote: Schema.String,
  pr: Schema.String,
  bucket: Bucket,
});

const Output = Schema.Struct({
  worktrees: Schema.Array(Row),
  counts: Schema.Struct({
    "hold-wip": Schema.Number,
    "hold-open-pr": Schema.Number,
    safe: Schema.Number,
    review: Schema.Number,
  }),
  problems: Schema.optional(Schema.String),
});

const DESCRIPTION = `Classify every git worktree in this repository by whether deleting it would lose work.

One row per worktree except the main one, with the evidence that produced its
bucket, and a \`counts\` tally so a cleanup can be sized without reading every row.

  const a = await tools.spectre.worktrees({})
  a.worktrees.filter(w => w.bucket === "safe").map(w => w.path)

## The buckets, and what each one licenses

- \`hold-wip\`. Tracked edits in the tree. Nothing may touch it.
- \`hold-open-pr\`. The branch has an OPEN PR. It is somebody's review.
- \`safe\`. HEAD is an ancestor of \`origin/main\`, or the branch has a PR that is
  no longer open. Deletion loses nothing the author was still holding.
- \`review\`. None of the above. An unpushed branch with no PR and no merge. Read
  it before deciding.

\`safe\` does not mean the work was good. A CLOSED PR is proof the author let it
go, and that is what \`safe\` accepts, so a rejected branch buckets as \`safe\`.
The evidence columns are there for the cases the bucket cannot settle.

## Reading the evidence

- \`dirty\`: \`clean\`, \`wip:<n>\` for n tracked changes, \`scratch:<n>\` for n
  untracked files. Untracked files are not WIP, which is why they are counted
  separately: a build artefact left behind is not a reason to hold a worktree.
- \`remote\`: \`pushed\`, \`ahead:<n>\` commits not on origin, \`no-remote\`, or
  \`detached\`. \`no-remote\` on a \`review\` row is the dangerous combination: the
  work exists in one directory and nowhere else.
- \`pr\`: \`#<number>/<state>\` or \`-\`. States are OPEN, CLOSED, and MERGED.
- \`ageDays\`: days since the HEAD commit, or -1 when the worktree has no commit.
- \`merged\`: HEAD is an ancestor of \`origin/main\`. A squash-merge leaves a
  branch that is not an ancestor, so a merged PR is often what proves this.

## Two things it will not do

It does not fetch, and it does not measure disk size. \`merged\` is false for
every worktree when \`origin/main\` has not been fetched, and \`problems\` says so
rather than quietly reporting nothing merged. A \`safe\` row under that warning
rests on the PR column alone. Fetch first when the answer decides a deletion.

## Determinism

The bucket is a pure function of the evidence, and the evidence is whatever git
and \`gh\` report at the moment of the call. Same repository state, same remote
state, same answer. \`ageDays\` moves with the clock, and \`gh\` and \`origin/main\`
move without you, so a row is a reading of now rather than a stored fact. Read it
twice before deleting anything.

It never deletes. This tool only tells you which paths a human, or a separate
step, may remove.

## When it cannot answer

A bad path, a missing \`git\`, or a directory that is not a repository comes back
in \`problems\` with an empty \`worktrees\`, never as a failed call. Rows that did
gather are still returned.`;

export const worktrees = (directory: string): Tool.Info<typeof Input, typeof Output> => ({
  name: "worktrees",
  description: DESCRIPTION,
  input: Input,
  output: Output,
  options: { namespace: "spectre", codemode: true, pinned: true, permission: "read" },
  execute: (input) =>
    Effect.promise(async () => {
      const report = await audit(input.repo ?? directory);
      return {
        output: {
          worktrees: report.worktrees,
          counts: count(report.worktrees),
          ...(report.problems.length > 0 ? { problems: report.problems.join("\n") } : {}),
        },
      };
    }),
});
