import { describe, expect, test } from "bun:test";
import { NONE, permitted, score, table, type Prediction } from "../score";
import type { Row } from "../fixture";

const p = (prompt: string, got: string, via: Prediction["via"] = "text"): Prediction => ({ prompt, got, via });

const rows: ReadonlyArray<Row> = [
  { prompt: "a", label: "one", provenance: "judged" },
  { prompt: "b", label: "one,two", provenance: "judged" },
  { prompt: "c", label: "two", provenance: "judged" },
  { prompt: "d", label: NONE, provenance: "neg" },
  { prompt: "e", label: NONE, provenance: "neg" },
];

const catalogue = ["one", "two"];

describe("permitted", () => {
  test("a single label is one permitted id", () => {
    expect(permitted("one")).toEqual(["one"]);
  });

  test("a multi label row permits any of them", () => {
    expect(permitted("one, two")).toEqual(["one", "two"]);
  });

  test("none is its own answer, not an empty set", () => {
    expect(permitted(NONE)).toEqual([NONE]);
  });
});

describe("score", () => {
  test("counts a first-choice hit when the answer is any permitted id", () => {
    const r = score(rows, [p("b", "two")], catalogue);
    expect(r.hit).toBe(1);
    expect(r.misses.map((m) => m.prompt)).toEqual(["a", "c", "d", "e"]);
  });

  test("abstaining on a none row is a hit, not a miss", () => {
    const r = score(rows, [p("d", NONE)], catalogue);
    expect(r.hit).toBe(1);
    expect(r.abstained).toBe(1);
  });

  test("abstaining on a judged row is a miss", () => {
    const r = score([rows[0]!], [p("a", NONE)], catalogue);
    expect(r.hit).toBe(0);
    expect(r.misses).toEqual([{ prompt: "a", want: ["one"], got: NONE }]);
  });

  test("a skill this plugin does not register is a miss, counted apart", () => {
    const r = score(rows, [p("a", "ripwire-before-you-build")], catalogue);
    expect(r.hit).toBe(0);
    expect(r.unparsable).toBe(1);
    expect(r.misses[0]?.got).toBe("ripwire-before-you-build");
  });

  test("a missing reply is a miss naming the prompt, never a silent pass", () => {
    const r = score(rows, [], catalogue);
    expect(r.hit).toBe(0);
    expect(r.misses).toHaveLength(5);
    expect(r.misses.every((m) => m.got === "(no reply)")).toBe(true);
  });

  test("an empty corpus scores zero rather than dividing by zero", () => {
    const r = score([], [], catalogue);
    expect(r.hitRate).toBe(0);
    expect(r.scored).toBe(0);
  });

  test("every via lands in its own column, including a skill activation", () => {
    for (const via of ["skill", "tool", "text", "silent"] as const) {
      const r = score([rows[0]!], [p("a", "one", via)], catalogue);
      expect(r.byVia).toEqual({ skill: 0, tool: 0, text: 0, silent: 0, [via]: 1 });
    }
  });

  test("no column is ever NaN, so no key can be invented", () => {
    const r = score(rows, [p("a", "one", "skill")], catalogue);
    expect(Object.values(r.byVia).every(Number.isFinite)).toBe(true);
  });
});

describe("per skill", () => {
  test("credits a win to the answer and a steal to whoever answered instead", () => {
    const r = score(
      [
        { prompt: "a", label: "one", provenance: "judged" },
        { prompt: "b", label: "one", provenance: "judged" },
      ],
      [
        p("a", "one"),
        p("b", "two"),
      ],
      catalogue,
    );
    const one = r.perSkill.find((s) => s.id === "one");
    const two = r.perSkill.find((s) => s.id === "two");
    expect(one).toEqual({ id: "one", permitted: 2, won: 1, stolen: 0 });
    expect(two).toEqual({ id: "two", permitted: 0, won: 0, stolen: 1 });
  });

  test("a multi label row credits every permitted id, and only the answer", () => {
    const r = score(
      [{ prompt: "b", label: "one,two", provenance: "judged" }],
      [p("b", "two")],
      catalogue,
    );
    expect(r.perSkill.find((s) => s.id === "one")?.permitted).toBe(1);
    expect(r.perSkill.find((s) => s.id === "two")?.won).toBe(1);
    expect(r.perSkill.find((s) => s.id === "one")?.won).toBe(0);
  });

  test("none is not a catalogue skill, so it gets no row", () => {
    const r = score(rows, [], catalogue);
    expect(r.perSkill.map((s) => s.id)).toEqual(["one", "two"]);
  });
});

describe("table", () => {
  test("every arm appears with its hit rate", () => {
    const out = table([
      { name: "bm25-desc", report: score(rows, [p("a", "one")], catalogue) },
      { name: "model", report: score(rows, [p("a", "two")], catalogue) },
    ]);
    expect(out).toContain("bm25-desc");
    expect(out).toContain("model");
    expect(out).toContain("20.0%");
  });

  test("one arm is not a divide by zero", () => {
    expect(table([{ name: "only", report: score([], [], catalogue) }])).toContain("0.0%");
  });

  test("a skill activation prints 1, not 0, in the first column", () => {
    const report = score([rows[0]!], [p("a", "one", "skill")], catalogue);
    expect(table([{ name: "model:x", report }])).toContain("1/0/0/0");
  });
});
