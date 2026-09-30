import { describe, expect, test } from "bun:test";
import {
  bucket,
  count,
  type Evidence,
  dirtyOf,
  dirtyLabel,
  prFor,
  type PullRequest,
  trackedChanges,
} from "../../tools/definitions/worktrees/classify";

/**
 * The bucket is the only judgement this tool makes, so it is the part tested against
 * literals. Every row below is one branch of the rule in `classify.ts`; a classifier
 * that returned `undefined` fails all of them.
 */

const clean: Evidence = { dirty: { kind: "clean" }, merged: true, patches: "landed", pushed: true };
const wip: Evidence = { ...clean, dirty: { kind: "wip", count: 1 } };
const scratch: Evidence = { ...clean, dirty: { kind: "scratch", count: 1 } };

describe("what outranks what", () => {
  test("tracked edits hold a worktree that also landed", () => {
    expect(bucket(wip)).toBe("hold-wip");
  });

  test("a branch that landed is safe whatever else is true", () => {
    expect(bucket(clean)).toBe("safe");
    expect(bucket({ ...clean, dirty: { kind: "scratch", count: 1 } })).toBe("safe");
  });

  test("squash evidence counts as landed on its own, since ancestry cannot see it", () => {
    expect(bucket({ dirty: { kind: "clean" }, merged: false, patches: "landed", pushed: true })).toBe("safe");
  });

  test("untracked files are not WIP, and do not hold a landed branch", () => {
    expect(bucket(scratch)).toBe("safe");
  });
});

describe("what the absence of a copy is worth", () => {
  test("a branch git hosts nowhere is held, not merely reviewed", () => {
    expect(bucket({ dirty: { kind: "clean" }, merged: false, patches: "unlanded", pushed: false })).toBe(
      "hold-unpushed",
    );
  });

  test("a pushed branch that did not land is review, never safe", () => {
    // It may carry an open pull request, which git cannot see.
    expect(bucket({ dirty: { kind: "clean" }, merged: false, patches: "unlanded", pushed: true })).toBe("review");
  });
});

describe("a read that failed is not the reassuring answer", () => {
  test("an unknown dirty never reaches safe", () => {
    // `clean` is what the delete decision reads as a licence, so a failed status
    // must not become it.
    expect(bucket({ dirty: { kind: "unknown" }, merged: false, patches: "unlanded", pushed: true })).toBe("review");
    expect(bucket({ dirty: { kind: "unknown" }, merged: "unknown", patches: "unknown", pushed: "unknown" })).toBe(
      "review",
    );
  });

  test("unknown base with no other proof is review, not safe", () => {
    expect(bucket({ dirty: { kind: "clean" }, merged: "unknown", patches: "unknown", pushed: true })).toBe("review");
  });
});

describe("count", () => {
  test("tallies all four buckets from zero", () => {
    expect(count([])).toEqual({ "hold-wip": 0, "hold-unpushed": 0, safe: 0, review: 0 });
  });

  test("each row lands in exactly one bucket", () => {
    const rows: ReadonlyArray<Evidence> = [
      wip,
      clean,
      { dirty: { kind: "clean" }, merged: false, patches: "unlanded", pushed: false },
    ];
    expect(count(rows.map((evidence) => ({ bucket: bucket(evidence) })))).toEqual({
      "hold-wip": 1,
      "hold-unpushed": 1,
      safe: 1,
      review: 0,
    });
  });
});

describe("tracked edits, counted once for both consumers", () => {
  test("untracked lines are scratch, not WIP", () => {
    expect(dirtyLabel(trackedChanges("?? new.txt\n?? other.txt"))).toBe("scratch:2");
  });

  test("a tracked line is WIP even beside untracked ones", () => {
    expect(dirtyLabel(trackedChanges(" M a.ts\n?? new.txt"))).toBe("wip:1");
  });

  test("nothing at all is clean", () => {
    expect(dirtyLabel(trackedChanges(""))).toBe("clean");
  });
});

describe("prFor", () => {
  const pr = (number: number, state: string, headRefName: string): PullRequest => ({
    number,
    state,
    headRefName,
  });

  test("no pull request reads as `-`", () => {
    expect(prFor("feat", [])).toBe("-");
  });

  test("a branch that is not named reads as `-`", () => {
    expect(prFor("feat", [pr(1, "OPEN", "other")])).toBe("-");
  });

  test("one match is reported as number and state", () => {
    expect(prFor("feat", [pr(12, "MERGED", "feat")])).toBe("#12/MERGED");
  });

  test("a reused branch name prefers the request that is still open", () => {
    // A branch outlives its pull request, so one name can carry several. The closed
    // one is proof the author let it go, and answering with it would report a branch
    // somebody is waiting on as finished.
    expect(prFor("feat", [pr(12, "MERGED", "feat"), pr(13, "OPEN", "feat")])).toBe("#13/OPEN");
  });

  test("two finished requests answer with either", () => {
    expect(["#12/CLOSED", "#9/CLOSED"]).toContain(prFor("feat", [pr(12, "CLOSED", "feat"), pr(9, "CLOSED", "feat")]));
  });
});
