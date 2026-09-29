import { describe, expect, test } from "bun:test";
import { bucket, count, prFor, type PullRequest } from "../../tools/definitions/worktrees/classify";

/**
 * The bucket is the only judgement this tool makes, so it is the part tested
 * against literals. Every row below is one branch of the rule in
 * `classify.ts`; a classifier that returned `undefined` fails all of them.
 */

const clean = { merged: false, dirty: "clean", pr: "-" };
const wip = { merged: false, dirty: "wip:2", pr: "-" };
const scratch = { merged: false, dirty: "scratch:14", pr: "-" };

describe("what outranks what", () => {
  test("tracked edits hold a worktree that is also merged and has an open PR", () => {
    expect(bucket({ merged: true, dirty: "wip:1", pr: "#12/OPEN" })).toBe("hold-wip");
  });

  test("an open PR outranks a merge", () => {
    expect(bucket({ merged: true, dirty: "clean", pr: "#12/OPEN" })).toBe("hold-open-pr");
  });
});

describe("safe", () => {
  test("an ancestor of origin/main", () => {
    expect(bucket({ ...clean, merged: true })).toBe("safe");
  });

  test("a PR that is no longer open, whatever its state", () => {
    expect(bucket({ ...clean, pr: "#12/MERGED" })).toBe("safe");
    expect(bucket({ ...clean, pr: "#12/CLOSED" })).toBe("safe");
  });
});

describe("review", () => {
  test("nothing proves the work landed", () => {
    expect(bucket(clean)).toBe("review");
  });

  test("untracked files are not a reason to hold", () => {
    expect(bucket(scratch)).toBe("review");
  });
});

describe("count", () => {
  test("tallies every bucket and starts at zero", () => {
    expect(
      count([{ bucket: "safe" }, { bucket: "safe" }, { bucket: "hold-wip" }, { bucket: "review" }]),
    ).toEqual({ "hold-wip": 1, "hold-open-pr": 0, safe: 2, review: 1 });
  });

  test("no worktrees is all zeroes, not a missing field", () => {
    expect(count([])).toEqual({ "hold-wip": 0, "hold-open-pr": 0, safe: 0, review: 0 });
  });
});

const pr = (number: number, state: string, headRefName: string): PullRequest => ({
  number,
  state,
  headRefName,
});

describe("prFor", () => {
  test("a branch nobody opened a pull request for reads as no PR", () => {
    expect(prFor("feature", [])).toBe("-");
    expect(prFor("feature", [pr(12, "OPEN", "other")])).toBe("-");
  });

  test("one pull request on the branch is the branch's pull request", () => {
    expect(prFor("feature", [pr(12, "MERGED", "other"), pr(13, "OPEN", "feature")])).toBe(
      "#13/OPEN",
    );
  });

  test("a reused branch name reports the open pull request, not the closed one", () => {
    // #12 was closed, the branch was recreated, #13 was opened under the same
    // name. Taking the first would report the closed one, which reads as `safe`.
    const pulled = [pr(12, "CLOSED", "feature"), pr(13, "OPEN", "feature")];

    expect(prFor("feature", pulled)).toBe("#13/OPEN");
    expect(bucket({ merged: false, dirty: "clean", pr: prFor("feature", pulled) })).toBe(
      "hold-open-pr",
    );
  });

  test("two finished pull requests on one name answer the same either way", () => {
    const pulled = [pr(12, "CLOSED", "feature"), pr(13, "MERGED", "feature")];

    expect(prFor("feature", pulled)).toBe("#12/CLOSED");
    expect(prFor("feature", [...pulled].reverse())).toBe("#13/MERGED");
  });
});
