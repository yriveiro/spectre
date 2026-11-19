import { describe, expect, test } from "bun:test";
import { deltas, deltaTable, flips, type Run, snapshot } from "../record";
import { type Prediction, score, type UsageSummary } from "../score";

const pred = (prompt: string, got: string, usage?: UsageSummary): Prediction => ({
  prompt,
  got,
  via: "text",
  ...(usage === undefined ? {} : { usage }),
});

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

describe("usage snapshots and deltas", () => {
  const u1: UsageSummary = {
    input: 200,
    output: 40,
    reasoning: 10,
    cacheRead: 50,
    cacheWrite: 20,
    total: 320,
    cost: 0.005,
  };
  const u2: UsageSummary = {
    input: 120,
    output: 30,
    reasoning: 0,
    cacheRead: 90,
    cacheWrite: 10,
    total: 250,
    cost: 0.0025,
  };

  test("snapshot carries usage on the arm when predictions report it", () => {
    const r = run([pred("a", "one", u1)]);
    expect(r.arms[0]?.usage).toEqual({ ...u1, tokensPerHit: 320 });
  });

  test("deltas surface token, cache, tokensPerHit, and cost changes when both snapshots carry usage", () => {
    const before = run([pred("a", "one", u1)]);
    const after = run([pred("a", "one", u2)]);
    const d = deltas(before, after);
    expect(d[0]?.usage).toEqual({
      before: { ...u1, tokensPerHit: 320 },
      after: { ...u2, tokensPerHit: 250 },
      total: -70,
      cacheRead: 40,
      cacheWrite: -10,
      cost: -0.0025,
      tokensPerHit: -70,
    });

    const formatted = deltaTable(d);
    expect(formatted).toContain("-70");
    expect(formatted).toContain("+40/-10");
    expect(formatted).toContain("-$0.0025");
  });

  test("deltas omit usage when an older baseline JSON snapshot lacks usage", () => {
    const legacyBefore = run([pred("a", "one")]);
    const after = run([pred("a", "one", u2)]);
    const d = deltas(legacyBefore, after);
    expect(d).toEqual([{ arm: "model:x", before: 0.5, after: 0.5, change: 0, state: "same" }]);
    const formatted = deltaTable(d);
    expect(formatted).not.toContain("NaN");
    expect(formatted).not.toContain("cost");
  });
});
