import { describe, expect, test } from "bun:test";
import { bucket, count } from "../../tools/definitions/worktrees/classify";

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
      count([
        { bucket: "safe" },
        { bucket: "safe" },
        { bucket: "hold-wip" },
        { bucket: "review" },
      ]),
    ).toEqual({ "hold-wip": 1, "hold-open-pr": 0, safe: 2, review: 1 });
  });

  test("no worktrees is all zeroes, not a missing field", () => {
    expect(count([])).toEqual({ "hold-wip": 0, "hold-open-pr": 0, safe: 0, review: 0 });
  });
});
