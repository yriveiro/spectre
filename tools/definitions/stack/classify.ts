export type Ci = "clean" | "pending" | "failing" | "github-rejected";

export type Snapshot = {
  readonly number: number;
  readonly kind: "open" | "merged" | "closed";
  readonly mergeable: string;
  readonly mergeStateStatus: string;
  readonly isDraft: boolean;
  readonly reviewDecision: string;
  readonly ci: Ci;
  /** Unresolved review threads. `-1` means `gh` could not read them. */
  readonly threads: number;
  readonly mergedAt: string | null;
};

export type BlockerKind =
  | "merge-conflicts"
  | "review-threads"
  | "failing-checks"
  | "merge-gate";

export type GateReason = "closed-without-merge" | "draft-pr" | "changes-requested";

export type Blocker = {
  readonly kind: BlockerKind;
  readonly pr: number;
  readonly detail: string;
};

export type PrDecision =
  | { readonly kind: "blocker"; readonly blocker: Blocker }
  | { readonly kind: "waiting"; readonly pr: number }
  | { readonly kind: "ready"; readonly pr: number }
  | { readonly kind: "merged"; readonly pr: number; readonly mergedAt: string | null };

/** `clear` belongs to a whole stack, never to one PR, so the two stay apart. */
export type StackDecision = PrDecision | { readonly kind: "clear"; readonly prs: ReadonlyArray<number> };

const conflict = (row: Snapshot): boolean =>
  row.kind === "open" &&
  (row.mergeable === "CONFLICTING" ||
    row.mergeStateStatus === "DIRTY" ||
    row.mergeStateStatus === "CONFLICTING");

const threads = (row: Snapshot): boolean => row.kind === "open" && row.threads !== 0;

const failing = (row: Snapshot): boolean =>
  row.kind === "open" && (row.ci === "failing" || row.ci === "github-rejected");

/** A merged PR never gates. A closed one is a gate, because it will not land. */
const gate = (row: Snapshot, allowDraft: boolean): GateReason | null => {
  if (row.kind === "merged") return null;
  if (row.kind === "closed") return "closed-without-merge";
  if (row.isDraft && !allowDraft) return "draft-pr";
  return row.reviewDecision === "CHANGES_REQUESTED" ? "changes-requested" : null;
};

/**
 * A draft waiting on CI is not a gate. It is a draft that has not run yet, and
 * blocking on it stops the work for a reason that resolves on its own.
 */
const gateBlocks = (row: Snapshot, allowDraft: boolean): Blocker | null => {
  const reason = gate(row, allowDraft);
  if (reason === null) return null;
  if (reason === "draft-pr" && row.kind === "open" && row.ci === "pending")
    return null;
  return { kind: "merge-gate", pr: row.number, detail: reason };
};

const conflictBlocker = (row: Snapshot): Blocker | null =>
  conflict(row)
    ? { kind: "merge-conflicts", pr: row.number, detail: row.mergeStateStatus }
    : null;

/**
 * An unreadable thread count blocks, because `unknown` and `clear` are not the
 * same answer and only one of them is safe to merge on. Reporting `ready` from a
 * row whose review feedback nobody read is the failure this guards.
 */
const threadBlocker = (row: Snapshot): Blocker | null => {
  if (!threads(row)) return null;
  return {
    kind: "review-threads",
    pr: row.number,
    detail: row.threads < 0 ? "unreadable" : `${row.threads} unresolved`,
  };
};

const ciBlocker = (row: Snapshot): Blocker | null => {
  if (!failing(row)) return null;
  return {
    kind: "failing-checks",
    pr: row.number,
    detail:
      row.ci === "github-rejected"
        ? "ci failing and GitHub refuses the merge"
        : "ci failing",
  };
};

/**
 * Tier-major: every conflict in the stack outranks every review thread, which
 * outranks every failing check, which outranks every gate. A conflict on the
 * last PR therefore beats an open thread on the first. The stack is a sequence,
 * so a blocker anywhere stops everything above it, and fixing the cheapest thing
 * first is how a stack gets unwedged.
 *
 * The nesting is the whole rule. Tier outside, rows inside. One predicate that
 * asked all three questions per row would answer the right question per PR and
 * the wrong question for the stack, and every test here that mixes tiers across
 * PRs would fail.
 */
/** For one PR the three tiers are just a question order, so they compose here. */
export const decide = (row: Snapshot, allowDraft: boolean): PrDecision => {
  const first =
    conflictBlocker(row) ?? threadBlocker(row) ?? ciBlocker(row) ?? gateBlocks(row, allowDraft);
  if (first !== null) return { kind: "blocker", blocker: first };
  if (row.kind === "open" && row.ci === "pending") return { kind: "waiting", pr: row.number };
  if (row.kind === "merged") return { kind: "merged", pr: row.number, mergedAt: row.mergedAt };
  return { kind: "ready", pr: row.number };
};

export const decideStack = (
  rows: ReadonlyArray<Snapshot>,
  allowDraft: boolean,
): StackDecision => {
  for (const ask of [conflictBlocker, threadBlocker, ciBlocker])
    for (const row of rows) {
      const blocking = ask(row);
      if (blocking !== null) return { kind: "blocker", blocker: blocking };
    }

  for (const row of rows) {
    const gated = gateBlocks(row, allowDraft);
    if (gated !== null) return { kind: "blocker", blocker: gated };
  }
  for (const row of rows)
    if (row.kind === "open" && row.ci === "pending") return { kind: "waiting", pr: row.number };

  return { kind: "clear", prs: rows.map((row) => row.number) };
};
