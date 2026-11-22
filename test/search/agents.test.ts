import { describe, expect, test } from "bun:test";
import { isSpectre } from "../../tools/definitions/search/agents";

describe("the agents the search feature belongs to", () => {
  test("each registered agent is Spectre's", () => {
    for (const agent of ["spectre", "operator", "sicko", "mnemonic", "nocturna"])
      expect(isSpectre(agent)).toBe(true);
  });

  test("a stock agent is not", () => {
    for (const agent of ["build", "plan", "general", "explore"]) expect(isSpectre(agent)).toBe(false);
  });
});
