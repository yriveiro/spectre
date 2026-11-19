import { describe, expect, test } from "bun:test";
import { blind } from "../../eval/routing/fixture";
import { rank } from "../../tools/definitions/routing";
import { DEFAULT_PROFILES } from "../../tools/definitions/routing/types";

/**
 * The routing surface, locked.
 *
 * The model arm is the judge; this test is the definitional half. It holds the
 * boundary clauses the corpus taught us, and it keeps the lexical arm from
 * getting worse. It is a floor, not a proof: a surface can pass this and still
 * be misread by a model.
 */

const descriptions = Object.entries(DEFAULT_PROFILES).flatMap(([profile, entry]) =>
  entry.match === undefined ? [] : [{ profile, text: entry.match }],
);

/** The judged rows the lexical arm gets wrong, grouped by the pair it confuses. */
const confusions = (): ReadonlyMap<string, number> => {
  const pairs = new Map<string, number>();
  for (const row of blind) {
    if (row.provenance !== "judged") continue;
    const got = rank(descriptions, row.prompt) ?? "none";
    if (got === row.label) continue;
    const pair = `${row.label} -> ${got}`;
    pairs.set(pair, (pairs.get(pair) ?? 0) + 1);
  }
  return pairs;
};

describe("the routing surface", () => {
  test("every profile carries a routing surface", () => {
    for (const [name, entry] of Object.entries(DEFAULT_PROFILES))
      expect(entry.match, `${name} has no match line`).toBeString();
  });

  test("the known confusions are excluded in words, not left to the model", () => {
    expect(DEFAULT_PROFILES.worker?.match).toContain("that is refactor");
    expect(DEFAULT_PROFILES.worker?.match).toContain("that is deep");
    expect(DEFAULT_PROFILES.refactor?.match).toContain("that is worker");
    expect(DEFAULT_PROFILES.refactor?.match).toContain("domain-wide rename");
    expect(DEFAULT_PROFILES.judgment?.match).toContain("that is worker");
    expect(DEFAULT_PROFILES.judgment?.match).toContain("that is deep");
    expect(DEFAULT_PROFILES.deep?.match).toContain("that is judgment");
    expect(DEFAULT_PROFILES.deep?.match).toContain("that is thinking");
    expect(DEFAULT_PROFILES.thinking?.match).toContain("that is deep");
  });

  test("the lexical arm does not confuse any pair more than three times", () => {
    const worst = Math.max(0, ...confusions().values());
    expect(worst).toBeLessThanOrEqual(3);
  });

  test("the lexical arm misses no more than twenty-eight judged rows", () => {
    const total = [...confusions().values()].reduce((sum, one) => sum + one, 0);
    expect(total).toBeLessThanOrEqual(28);
  });
});
