import type { Tool } from "@opencode/schema/tool";
import { Effect, Schema } from "effect";
import { type Blocker, decide, decideStack, type Snapshot } from "./classify";
import { openPullRequests, readPr } from "./read";

const Input = Schema.Struct({
  prs: Schema.optional(Schema.Array(Schema.Number)).annotate({
    description:
      "Pull request numbers, lowest first. Omit to use every open PR in the repository.",
  }),
  allowDraft: Schema.optional(Schema.Boolean).annotate({
    description: "Treat a draft as landable. Default false.",
  }),
});

const Row = Schema.Struct({
  number: Schema.Number,
  kind: Schema.Literals(["open", "merged", "closed"]),
  mergeable: Schema.String,
  mergeStateStatus: Schema.String,
  isDraft: Schema.Boolean,
  reviewDecision: Schema.String,
  ci: Schema.Literals(["clean", "pending", "failing", "github-rejected"]),
  threads: Schema.Number,
  decision: Schema.Literals(["blocker", "waiting", "ready", "merged"]),
  blocker: Schema.optional(
    Schema.Struct({
      kind: Schema.Literals([
        "merge-conflicts",
        "review-threads",
        "failing-checks",
        "merge-gate",
      ]),
      pr: Schema.Number,
      detail: Schema.String,
    }),
  ),
});

const Output = Schema.Struct({
  stack: Schema.Literals(["blocker", "waiting", "clear"]),
  blocker: Schema.optional(
    Schema.Struct({
      kind: Schema.Literals([
        "merge-conflicts",
        "review-threads",
        "failing-checks",
        "merge-gate",
      ]),
      pr: Schema.Number,
      detail: Schema.String,
    }),
  ),
  ready: Schema.Array(Schema.Number),
  rows: Schema.Array(Row),
  problems: Schema.optional(Schema.String),
});

const DESCRIPTION = `Decide what to do next with a stack of pull requests. One call, one answer.

  const s = await tools.spectre.stack({})
  if (s.stack === "clear") merge s.ready bottom-up, one at a time
  else fix s.blocker on PR s.blocker.pr first

\`stack\` is the verdict for the whole set, and \`rows\` is the per-PR evidence
behind it, so the answer is checkable rather than asserted.

## The one rule that matters

**Tier-major.** Every merge conflict in the stack outranks every review thread,
which outranks every failing check, which outranks every merge gate. A conflict
on PR 40 beats an open thread on PR 12, because a stack is a sequence: a blocker
anywhere stops everything above it, and fixing the cheapest thing first is how a
stack gets unwedged. \`blocker.pr\` names the one to fix first. Fixing the oldest
PR in the list is usually wrong.

The four blocker kinds, in the order they are checked:

- \`merge-conflicts\`. \`mergeable\` is CONFLICTING, or \`mergeStateStatus\` is DIRTY
  or CONFLICTING.
- \`review-threads\`. Unresolved review threads exist. \`detail\` carries the count.
- \`failing-checks\`. A check concluded FAILURE, TIMED_OUT, CANCELLED,
  ACTION_REQUIRED, or STARTUP_FAILURE. \`detail\` says \`ci failing and GitHub
  refuses the merge\` when the merge is also BLOCKED, which is a different thing
  from red CI: GitHub will not merge it until the red goes away.
- \`merge-gate\`. Closed without merging, a draft, or CHANGES_REQUESTED.

A draft whose CI is still running is deliberately **not** a gate. It becomes
\`waiting\` instead, so a draft does not block a stack that is merely waiting for
its own checks. Pass \`allowDraft: true\` to treat drafts as landable.

## waiting, clear, and what to do

- \`stack: "waiting"\`. Nothing is wrong; a check is still running. \`blocker\` is
  absent and \`ready\` lists what has already passed. Wait, do not intervene.
- \`stack: "clear"\`. Every PR is mergeable. \`ready\` is in the order to land
  them: lowest first. Squash-merge one at a time, then re-run, because the next
  PR's base moves.
- \`stack: "blocker"\`. \`blocker.pr\` is the one to fix. Fixing a different PR
  first wastes the run.

## What it will not do

It does not merge, rebase, comment, or push. It reads \`gh\` and decides. The
merge is a separate, irreversible step and stays yours.

## Determinism, and the honest limit

The decision is a pure function of the rows, and the rows are whatever \`gh\`
reports at the moment of the call. Same PR state, same answer. CI is the input
that moves without you, so re-run before acting on a \`clear\`; a PR that went red
since your last read still reads green here.

A row \`gh\` could not read is returned as \`unknown\`, not as good news:
\`threads: -1\` means unreadable, not zero, and such a row is never \`ready\`.
Every such row adds a line to \`problems\`. Read \`problems\` before trusting a
\`clear\`, because a stack you cannot see is not a stack that is fine.`;

const decisionOf = (row: Snapshot, allowDraft: boolean) => {
  const one = decide(row, allowDraft);
  return one.kind === "blocker"
    ? { decision: "blocker" as const, blocker: one.blocker }
    : { decision: one.kind };
};

export const stack = (directory: string): Tool.Info<typeof Input, typeof Output> => ({
  name: "stack",
  description: DESCRIPTION,
  input: Input,
  output: Output,
  options: { namespace: "spectre", codemode: true, pinned: true, permission: "read" },
  execute: (input) =>
    Effect.promise(async () => {
      const allowDraft = input.allowDraft ?? false;
      const problems: Array<string> = [];

      const numbers =
        input.prs ?? (await openPullRequests(directory));
      if (numbers.length === 0)
        return {
          output: {
            stack: "clear" as const,
            ready: [],
            rows: [],
            ...(problems.length > 0 ? { problems: problems.join("\n") } : {}),
          },
        };

      const reads = await Promise.all(numbers.map((one) => readPr(directory, one)));
      for (const read of reads) problems.push(...read.problems);

      const rows = reads.map((read) => ({
        ...read.snapshot,
        ...decisionOf(read.snapshot, allowDraft),
      }));
      const snapshots = reads.map((read) => read.snapshot);

      const verdict = decideStack(snapshots, allowDraft);
      const ready = snapshots
        .filter((row) => decide(row, allowDraft).kind === "ready")
        .map((row) => row.number);

      const blocker: Blocker | undefined = verdict.kind === "blocker" ? verdict.blocker : undefined;

      return {
        output: {
          stack: verdict.kind === "blocker" ? ("blocker" as const) : verdict.kind === "waiting" ? ("waiting" as const) : ("clear" as const),
          ...(blocker === undefined ? {} : { blocker }),
          ready,
          rows,
          ...(problems.length > 0 ? { problems: problems.join("\n") } : {}),
        },
      };
    }),
});
