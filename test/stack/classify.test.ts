import { describe, expect, test } from "bun:test";
import { decide, decideStack, type Snapshot } from "../../tools/definitions/stack/classify";

/**
 * A clean, open, landable PR. Every test below is this one with exactly the
 * fields under discussion changed, so a failure names the rule that broke
 * rather than a pile of unrelated differences.
 */
const open = (over: Partial<Snapshot> = {}): Snapshot => ({
  number: 1,
  kind: "open",
  mergeable: "MERGEABLE",
  mergeStateStatus: "CLEAN",
  isDraft: false,
  reviewDecision: "APPROVED",
  ci: "clean",
  threads: 0,
  mergedAt: null,
  ...over,
});

describe("one PR at a time", () => {
  test("clean, approved, no threads is ready", () => {
    expect(decide(open(), false)).toEqual({ kind: "ready", pr: 1 });
  });

  test("a conflict is a blocker even when everything else is fine", () => {
    expect(decide(open({ mergeable: "CONFLICTING" }), false)).toEqual({
      kind: "blocker",
      blocker: { kind: "merge-conflicts", pr: 1, detail: "CLEAN" },
    });
  });

  test("DIRTY is a conflict even though mergeable still says MERGEABLE", () => {
    expect(decide(open({ mergeStateStatus: "DIRTY" }), false).kind).toBe("blocker");
  });

  test("an unresolved thread blocks and names the count", () => {
    expect(decide(open({ threads: 3 }), false)).toEqual({
      kind: "blocker",
      blocker: { kind: "review-threads", pr: 1, detail: "3 unresolved" },
    });
  });

  test("failing CI blocks", () => {
    expect(decide(open({ ci: "failing" }), false)).toEqual({
      kind: "blocker",
      blocker: { kind: "failing-checks", pr: 1, detail: "ci failing" },
    });
  });

  test("CI failing while BLOCKED is a different act from red CI", () => {
    expect(
      decide(open({ ci: "github-rejected", mergeStateStatus: "BLOCKED" }), false),
    ).toEqual({
      kind: "blocker",
      blocker: {
        kind: "failing-checks",
        pr: 1,
        detail: "ci failing and GitHub refuses the merge",
      },
    });
  });

  test("CHANGES_REQUESTED is a gate", () => {
    expect(decide(open({ reviewDecision: "CHANGES_REQUESTED" }), false)).toEqual({
      kind: "blocker",
      blocker: { kind: "merge-gate", pr: 1, detail: "changes-requested" },
    });
  });

  test("a closed PR is a gate, because it will not land", () => {
    expect(decide(open({ kind: "closed" }), false)).toEqual({
      kind: "blocker",
      blocker: { kind: "merge-gate", pr: 1, detail: "closed-without-merge" },
    });
  });

  test("a merged PR is not a gate and not a blocker", () => {
    expect(decide(open({ kind: "merged", mergedAt: "2026-09-01T00:00:00Z" }), false)).toEqual({
      kind: "merged",
      pr: 1,
      mergedAt: "2026-09-01T00:00:00Z",
    });
  });
});

describe("drafts", () => {
  test("a draft gates by default", () => {
    expect(decide(open({ isDraft: true }), false)).toEqual({
      kind: "blocker",
      blocker: { kind: "merge-gate", pr: 1, detail: "draft-pr" },
    });
  });

  test("a draft is landable when allowDraft is set", () => {
    expect(decide(open({ isDraft: true }), true)).toEqual({ kind: "ready", pr: 1 });
  });

  test("a draft still running its own CI is waiting, not a blocker", () => {
    expect(decide(open({ isDraft: true, ci: "pending" }), false)).toEqual({
      kind: "waiting",
      pr: 1,
    });
  });
});

describe("a row gh could not read", () => {
  test("an unreadable thread count blocks rather than passing as clear", () => {
    expect(decide(open({ threads: -1 }), false)).toEqual({
      kind: "blocker",
      blocker: { kind: "review-threads", pr: 1, detail: "unreadable" },
    });
  });

  test("so an unreadable row is never ready, whatever else it says", () => {
    for (const ci of ["clean", "pending"] as const)
      expect(decide(open({ threads: -1, ci }), false).kind).not.toBe("ready");
  });
});

describe("the stack is tier-major", () => {
  const low = open({ number: 12, threads: 2 });
  const high = open({ number: 40, mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" });

  test("a conflict on the last PR outranks a thread on the first", () => {
    expect(decideStack([low, high], false)).toEqual({
      kind: "blocker",
      blocker: { kind: "merge-conflicts", pr: 40, detail: "DIRTY" },
    });
  });

  test("reversing the order does not change the verdict", () => {
    expect(decideStack([high, low], false)).toEqual(decideStack([low, high], false));
  });

  test("a thread outranks a failing check further up the stack", () => {
    const failing = open({ number: 90, ci: "failing" });
    expect(decideStack([failing, open({ number: 3, threads: 1 })], false)).toEqual({
      kind: "blocker",
      blocker: { kind: "review-threads", pr: 3, detail: "1 unresolved" },
    });
  });

  test("a gate is checked only after every tier above it is clean", () => {
    const gated = open({ number: 5, reviewDecision: "CHANGES_REQUESTED" });
    const failing = open({ number: 7, ci: "failing" });
    expect(decideStack([gated, failing], false).kind).toBe("blocker");
    expect(decideStack([gated, failing], false)).toEqual({
      kind: "blocker",
      blocker: { kind: "failing-checks", pr: 7, detail: "ci failing" },
    });
  });

  test("one pending PR makes the stack waiting, not clear", () => {
    expect(decideStack([open({ number: 1 }), open({ number: 2, ci: "pending" })], false)).toEqual({
      kind: "waiting",
      pr: 2,
    });
  });

  test("every PR landable is clear, in the order given", () => {
    expect(decideStack([open({ number: 4 }), open({ number: 9 })], false)).toEqual({
      kind: "clear",
      prs: [4, 9],
    });
  });
});
