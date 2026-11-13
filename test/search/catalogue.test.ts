import { describe, expect, test } from "bun:test";
import { shape, type Draft } from "../../tools/definitions/search/catalogue";
import { CONTRACT } from "../../tools/definitions/search/contract";

const draft = (overrides?: Partial<Draft>): Draft => ({
  system: [],
  tools: {},
  ...overrides,
});

describe("search context shape", () => {
  test("shape appends the rule once, and a second call does not append a second copy", () => {
    const asked = draft();
    shape(asked);
    expect(asked.system).toHaveLength(1);
    expect(asked.system.at(-1)?.text).toBe(CONTRACT.rule);

    shape(asked);
    expect(asked.system).toHaveLength(1);
  });

  test("a draft with tools.grep loses grep and gains ripgrep with the ripgrep description and the same input", () => {
    const input = { type: "object" };
    const grep = { description: "old", input };
    const asked = draft({ tools: { grep } });
    shape(asked);
    expect("grep" in asked.tools).toBe(false);
    expect(asked.tools["ripgrep"]?.description).toBe(CONTRACT.ripgrep);
    expect(asked.tools["ripgrep"]?.input).toBe(input);
    expect(asked.tools["ripgrep"]).toBe(grep);
  });

  test("a draft that already has ripgrep keeps its description and loses grep", () => {
    const asked = draft({
      tools: {
        grep: { description: "old", input: {} },
        ripgrep: { description: "kept", input: {} },
      },
    });
    shape(asked);
    expect("grep" in asked.tools).toBe(false);
    expect(asked.tools["ripgrep"]?.description).toBe("kept");
  });

  test("the appended rule names both spectre_search and ripgrep", () => {
    const asked = draft();
    shape(asked);
    const rule = asked.system.at(-1)?.text ?? "";
    expect(rule).toContain("spectre_search");
    expect(rule).toContain("ripgrep");
  });
});
