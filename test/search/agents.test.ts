import { describe, expect, test } from "bun:test";
import { isSpectre } from "../../tools/definitions/search/agents";

/** The membership is a decision: four ids carry the feature, and a stock id carries none of it. */
describe("the agents the search feature belongs to", () => {
  test("each registered agent is Spectre's", () => {
    for (const agent of ["spectre", "operator", "sicko", "mnemonic"])
      expect(isSpectre(agent)).toBe(true);
  });

  test("a stock agent is not", () => {
    for (const agent of ["build", "plan", "general", "explore"]) expect(isSpectre(agent)).toBe(false);
  });
});
