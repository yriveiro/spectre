import { describe, expect, test } from "bun:test";
import type { Row } from "../fixture";
import { NONE, type Price, score } from "../score";

/**
 * The rates are per million tokens, input plus output. Every one of them is
 * exact in binary, so the totals below are hand arithmetic and not a rounded
 * read. The profile names are the ones the config carries.
 */
const prices: ReadonlyArray<Price> = [
  { profile: "mechanical", rate: 0.25, effort: "low" },
  { profile: "search", rate: 0.5, effort: "medium" },
  { profile: "judgment", rate: 1.5, effort: "high" },
  { profile: "thinking", rate: 2, effort: "max" },
];

const mechanical: Row = {
  prompt: "rename a local variable",
  label: "mechanical",
  provenance: "judged",
};
const search: Row = {
  prompt: "find every caller of the parser",
  label: "search",
  provenance: "judged",
};
const judgment: Row = {
  prompt: "redesign the module boundary",
  label: "judgment",
  provenance: "judged",
};
const thinking: Row = {
  prompt: "prove the invariant holds",
  label: "thinking",
  provenance: "judged",
};
const offTopic: Row = {
  prompt: "what time is it in Lisbon",
  label: NONE,
  provenance: "neg",
};
const poem: Row = { prompt: "write a poem about the sea", label: NONE, provenance: "neg" };

const corpus: ReadonlyArray<Row> = [mechanical, search, judgment, thinking, offTopic, poem];

const p = (row: Row, got: string) => ({ prompt: row.prompt, got });

describe("score", () => {
  test("a hit is the profile a human named, and it costs nothing", () => {
    const r = score([mechanical], [p(mechanical, "mechanical")], prices);
    expect(r.scored).toBe(1);
    expect(r.hit).toBe(1);
    expect(r.hitRate).toBe(1);
    expect(r.regret).toBe(0);
    expect(r.regretPerRow).toBe(0);
    expect(r.misses).toEqual([]);
  });

  test("a miss costs the profile a human named, not the profile the arm named", () => {
    const r = score(
      [search, mechanical],
      [p(search, "mechanical"), p(mechanical, "search")],
      prices,
    );
    // 0.5 + 0.25 = 0.75. A price read off the arm's own answer would swap the
    // two lines. The test asserts each line, and not only the total.
    expect(r.misses).toEqual([
      { prompt: search.prompt, want: "search", got: "mechanical", cost: 0.5 },
      { prompt: mechanical.prompt, want: "mechanical", got: "search", cost: 0.25 },
    ]);
    expect(r.regret).toBe(0.75);
  });

  test("an abstention on a judged row is priced like the wrong answer it is", () => {
    const r = score([thinking], [p(thinking, NONE)], prices);
    expect(r.scored).toBe(1);
    expect(r.hit).toBe(0);
    expect(r.abstained).toBe(1);
    expect(r.regret).toBe(2);
    expect(r.misses).toEqual([{ prompt: thinking.prompt, want: "thinking", got: NONE, cost: 2 }]);
  });

  test("a negative row the arm stayed quiet on moves no counter and no rate", () => {
    const r = score([offTopic], [p(offTopic, NONE)], prices);
    expect(r.scored).toBe(0);
    expect(r.hit).toBe(0);
    expect(r.hitRate).toBe(0);
    expect(r.abstained).toBe(0);
    expect(r.fired).toBe(0);
    expect(r.regret).toBe(0);
    expect(r.regretPerRow).toBe(0);
    expect(r.misses).toEqual([]);
  });

  test("a fired negative row costs nothing and is counted apart from the price", () => {
    const r = score([offTopic], [p(offTopic, "search")], prices);
    expect(r.fired).toBe(1);
    expect(r.scored).toBe(0);
    expect(r.regret).toBe(0);
    expect(r.byProfile).toEqual([]);
    expect(r.misses).toEqual([{ prompt: offTopic.prompt, want: NONE, got: "search", cost: 0 }]);
  });

  test("the per-profile table counts the rows a profile owns and what its misses cost", () => {
    const r = score(
      corpus,
      [
        p(mechanical, "mechanical"),
        p(search, "judgment"),
        p(judgment, "thinking"),
        p(thinking, NONE),
        p(offTopic, NONE),
        p(poem, "search"),
      ],
      prices,
    );
    expect(r.byProfile).toEqual([
      { profile: "mechanical", rows: 1, hit: 1, regret: 0 },
      { profile: "search", rows: 1, hit: 0, regret: 0.5 },
      { profile: "judgment", rows: 1, hit: 0, regret: 1.5 },
      { profile: "thinking", rows: 1, hit: 0, regret: 2 },
    ]);
    // 0.5 + 1.5 + 2 + 0 = 4. The firing row is the zero.
    expect(r.regret).toBe(4);
    // 4 / 4 judged rows.
    expect(r.regretPerRow).toBe(1);
    expect(r.scored).toBe(4);
    expect(r.hit).toBe(1);
    expect(r.hitRate).toBe(0.25);
    expect(r.abstained).toBe(1);
    expect(r.fired).toBe(1);
    expect(r.misses.map((one) => one.prompt)).toEqual([
      search.prompt,
      judgment.prompt,
      thinking.prompt,
      poem.prompt,
    ]);
  });

  test("a profile that wins another profile's row is not charged for it, and the victim pays", () => {
    const r = score([mechanical, search], [p(mechanical, "search"), p(search, "search")], prices);
    // Search wins both rows. Its own line is clean, and mechanical carries the
    // 0.25, which is the loss the average would hide.
    expect(r.byProfile).toEqual([
      { profile: "mechanical", rows: 1, hit: 0, regret: 0.25 },
      { profile: "search", rows: 1, hit: 1, regret: 0 },
    ]);
    expect(r.hit).toBe(1);
    expect(r.regret).toBe(0.25);
  });

  test("two rows for one profile count two rows and one hit", () => {
    const again: Row = {
      prompt: "rename another local variable",
      label: "mechanical",
      provenance: "judged",
    };
    const r = score([mechanical, again], [p(mechanical, "mechanical"), p(again, "search")], prices);
    // One hit and one miss at 0.25, over 2 rows. The hit rate is 1 / 2.
    expect(r.byProfile).toEqual([{ profile: "mechanical", rows: 2, hit: 1, regret: 0.25 }]);
    expect(r.hitRate).toBe(0.5);
  });

  test("a profile with no judged row gets no table row, so a zero cannot pass for a clean sheet", () => {
    const r = score([mechanical], [p(mechanical, "mechanical")], prices);
    expect(r.byProfile.map((one) => one.profile)).toEqual(["mechanical"]);
  });

  test("an arm that abstains on every judged row reads zero, not accurate", () => {
    const r = score(
      corpus,
      corpus.map((row) => p(row, NONE)),
      prices,
    );
    expect(r.hit).toBe(0);
    expect(r.hitRate).toBe(0);
    expect(r.abstained).toBe(4);
    expect(r.fired).toBe(0);
    // 0.25 + 0.5 + 1.5 + 2 = 4.25, and 4.25 / 4 = 1.0625.
    expect(r.regret).toBe(4.25);
    expect(r.regretPerRow).toBe(1.0625);
    expect(r.misses).toHaveLength(4);
  });

  test("a row with no reply is a miss, priced when a profile was expected and never a fire", () => {
    const r = score([judgment, offTopic], [], prices);
    expect(r.scored).toBe(1);
    expect(r.fired).toBe(0);
    expect(r.abstained).toBe(0);
    expect(r.regret).toBe(1.5);
    expect(r.misses).toEqual([
      { prompt: judgment.prompt, want: "judgment", got: "(no reply)", cost: 1.5 },
      { prompt: offTopic.prompt, want: NONE, got: "(no reply)", cost: 0 },
    ]);
  });

  test("a judged profile with no price stops the report even when the arm was right", () => {
    const unpriced = prices.filter((one) => one.profile !== "thinking");
    expect(() => score([thinking], [p(thinking, "thinking")], unpriced)).toThrow(/thinking/);
  });

  test("a prediction for a prompt the corpus does not hold is not a scored row", () => {
    const r = score(
      [mechanical],
      [p(mechanical, "mechanical"), { prompt: "outside the corpus", got: "search" }],
      prices,
    );
    expect(r.scored).toBe(1);
    expect(r.hit).toBe(1);
    expect(r.misses).toEqual([]);
  });

  test("an empty corpus reads zero and never NaN", () => {
    const r = score([], [], prices);
    expect(r).toEqual({
      scored: 0,
      hit: 0,
      hitRate: 0,
      abstained: 0,
      fired: 0,
      byProfile: [],
      misses: [],
      regret: 0,
      regretPerRow: 0,
    });
  });
});
