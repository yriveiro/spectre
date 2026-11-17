import { Tool } from "@opencode/plugin/effect";
import { Effect, Schema } from "effect";
import { type Blocker, decide, decideStack, type Snapshot } from "./classify";
import { listingFor, readPr, repo } from "./read";

const Input = Schema.Struct({
  prs: Schema.optional(Schema.Array(Schema.Number)).annotate({
    description: "Pull request numbers, lowest first. Omit to use every open PR in the repository.",
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
      kind: Schema.Literals(["merge-conflicts", "review-threads", "failing-checks", "merge-gate"]),
      pr: Schema.Number,
      detail: Schema.String,
    }),
  ),
});

const Output = Schema.Struct({
  stack: Schema.Literals(["blocker", "waiting", "clear"]),
  blocker: Schema.optional(
    Schema.Struct({
      kind: Schema.Literals(["merge-conflicts", "review-threads", "failing-checks", "merge-gate"]),
      pr: Schema.Number,
      detail: Schema.String,
    }),
  ),
  ready: Schema.Array(Schema.Number),
  rows: Schema.Array(Row),
  problems: Schema.optional(Schema.String),
});

const DESCRIPTION = `Evaluate stacked pull requests to determine merge order, ready PRs, CI status, and the highest-priority blocker.
Inspects open PRs via gh and returns stack status "clear" (with bottom-up merge order in ready), "waiting" (checks pending), or "blocker", ranking merge-conflicts ahead of review-threads, failing-checks, and merge-gate across the PR stack.`;

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
  options: { namespace: "spectre", codemode: true, permission: "read" },
  execute: (input) =>
    Effect.gen(function* () {
      const allowDraft = input.allowDraft ?? false;
      const problems: Array<string> = [];

      const listed = yield* Effect.tryPromise(() => listingFor(directory, input.prs)).pipe(
        Effect.mapError(
          (cause) =>
            new Tool.Error({
              message: `gh could not list the open pull requests, so this stack decides nothing: ${
                cause instanceof Error ? cause.message : String(cause)
              }`,
            }),
        ),
      );

      // A listing that failed is not an empty stack. `Output` has no state for
      // "could not tell", so the tool fails rather than report a clear one.
      if ("problem" in listed)
        return yield* Effect.fail(
          new Tool.Error({
            message: `gh could not list the open pull requests, so this stack decides nothing: ${listed.problem}`,
          }),
        );

      const numbers = listed.numbers;
      if (numbers.length === 0) return { output: { stack: "clear" as const, ready: [], rows: [] } };

      // One slug for the whole listing, resolved here rather than per row.
      const slug = yield* Effect.promise(() => repo(directory));
      const reads = yield* Effect.promise(() =>
        Promise.all(numbers.map((one) => readPr(directory, one, slug))),
      );
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
          stack:
            verdict.kind === "blocker"
              ? ("blocker" as const)
              : verdict.kind === "waiting"
                ? ("waiting" as const)
                : ("clear" as const),
          ...(blocker === undefined ? {} : { blocker }),
          ready,
          rows,
          ...(problems.length > 0 ? { problems: problems.join("\n") } : {}),
        },
      };
    }),
});
