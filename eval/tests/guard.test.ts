import { describe, expect, test } from "bun:test";
import { complete, head, systemic } from "../guard";

describe("systemic", () => {
  test("a reason repeated to the threshold stops the run", () => {
    expect(systemic(["quota", "quota", "quota"], 3)).toBe("quota");
  });

  test("below the threshold it does not", () => {
    expect(systemic(["quota", "quota"], 3)).toBeUndefined();
  });

  test("different reasons are different failures", () => {
    expect(systemic(["quota", "timeout", "quota", "timeout"], 3)).toBeUndefined();
  });

  test("a success between failures resets nothing, because a quota is systemic", () => {
    expect(systemic(["quota", undefined, "quota", "quota"], 3)).toBe("quota");
  });

  test("no failures at all is not a reason to stop", () => {
    expect(systemic([undefined, undefined], 2)).toBeUndefined();
  });

  test("an empty run is not a reason to stop", () => {
    expect(systemic([], 1)).toBeUndefined();
  });
});

describe("head", () => {
  test("takes the leading rows", () => {
    expect(head([1, 2, 3, 4], 2)).toEqual([1, 2]);
  });

  test("a count past the end returns everything, not nothing", () => {
    expect(head([1, 2], 9)).toEqual([1, 2]);
  });

  test("zero rows is an empty corpus, not the whole one", () => {
    expect(head([1, 2], 0)).toEqual([]);
  });
});

describe("complete", () => {
  test("every row answered is complete", () => {
    expect(complete([{ a: 1 }, { a: 2 }], 2)).toBe(true);
  });

  test("a halted run is not complete, and sparse holes must not read as done", () => {
    const out: Array<unknown> = [{ a: 1 }, { a: 2 }, { a: 3 }]
    out.length = 5
    // `some` skips holes in a sparse array, which is how a halted run got scored.
    expect(out.some((one) => one === undefined)).toBe(false)
    expect(complete(out, 5)).toBe(false)
  });

  test("an untouched run is not complete either", () => {
    expect(complete([], 3)).toBe(false);
  });

  test("a corpus of zero rows is trivially complete", () => {
    expect(complete([], 0)).toBe(true);
  });
});
