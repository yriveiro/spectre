import { describe, expect, test } from "bun:test";
import { deltaTable, deltas, flips, snapshot, type Run } from "../record";
import { score, type Prediction } from "../score";

const pred = (prompt: string, got: string): Prediction => ({ prompt, got, via: "text" });

const rows = [
  { prompt: "a", label: "one", provenance: "judged" as const },
  { prompt: "b", label: "two", provenance: "judged" as const },
];
const catalogue = ["one", "two"];

const run = (predictions: ReadonlyArray<Prediction>): Run =>
  snapshot("held-out", catalogue, [
    { name: "model:x", report: score(rows, predictions, catalogue), predictions },
  ]);

describe("snapshot", () => {
  test("keeps the predictions, so a later run can be compared row by row", () => {
    const r = run([pred("a", "one")]);
    expect(r.arms[0]?.predictions).toEqual([pred("a", "one")]);
    expect(r.slice).toBe("held-out");
  });
});

describe("deltas", () => {
  test("a first run reports every arm as new rather than as a 100% gain", () => {
    const d = deltas(undefined, run([pred("a", "one")]));
    expect(d).toEqual([{ arm: "model:x", after: 0.5, state: "new" }]);
  });

  test("an improvement is up and carries the signed change", () => {
    const before = run([pred("a", "two")]);
    const after = run([pred("a", "one"), pred("b", "two")]);
    expect(deltas(before, after)).toEqual([
      { arm: "model:x", before: 0, after: 1, change: 1, state: "up" },
    ]);
  });

  test("a regression is down, and not rounded away", () => {
    const before = run([pred("a", "one"), pred("b", "two")]);
    expect(deltas(before, run([pred("a", "one")]))[0]?.state).toBe("down");
  });

  test("an identical run is same, with a zero change", () => {
    const r = run([pred("a", "one")]);
    expect(deltas(r, r)[0]).toEqual({
      arm: "model:x",
      before: 0.5,
      after: 0.5,
      change: 0,
      state: "same",
    });
  });

  test("an arm that disappears is gone, not silently dropped", () => {
    const before = run([pred("a", "one")]);
    const after: Run = { ...before, arms: [] };
    expect(deltas(before, after)[0]?.state).toBe("gone");
  });

  test("the table names every arm", () => {
    const out = deltaTable(deltas(undefined, run([pred("a", "one")])));
    expect(out).toContain("model:x");
    expect(out).toContain("new");
  });
});

describe("flips", () => {
  test("a row that changed answer is reported with both answers", () => {
    const flipsFound = flips(run([pred("a", "two")]), run([pred("a", "one"), pred("b", "two")]));
    expect(flipsFound).toEqual([{ arm: "model:x", prompt: "a", from: "two", to: "one" }]);
  });

  test("a row that did not change is not reported", () => {
    expect(flips(run([pred("a", "one")]), run([pred("a", "one")]))).toEqual([]);
  });

  test("no baseline means no flips to report", () => {
    expect(flips(undefined, run([pred("a", "one")]))).toEqual([]);
  });

  test("a new arm does not report every row as a flip", () => {
    const before: Run = { ...run([]), arms: [] };
    expect(flips(before, run([pred("a", "one")]))).toEqual([]);
  });
});
