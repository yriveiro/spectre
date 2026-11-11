import { describe, expect, test } from "bun:test";
import { priorityOf } from "../../tools/definitions/routing/order";

const models = {
  first: "opencode-go/deepseek-v4.1-flash",
  second: "opencode-go/glm-5.3-flash",
};

describe("priorityOf", () => {
  test("the priority array orders the allowlist, not the models object", () => {
    const found = priorityOf(models, ["second", "first"]);
    expect(found.problems).toEqual([]);
    expect(found.ranked.map((one) => [one.alias, one.priority])).toEqual([
      ["second", 1],
      ["first", 2],
    ]);
  });

  test("a model with no place in the priority array is a problem", () => {
    const found = priorityOf(models, ["second"]);
    expect(found.problems).toContain(
      'priority: "first" is missing. Every model needs a place in the order.',
    );
  });

  test("a priority name with no model is a problem", () => {
    const found = priorityOf(models, ["second", "first", "ghost"]);
    expect(found.problems).toContain(
      'priority: "ghost" is not a model in models. Names: first, second',
    );
  });

  test("a repeated name is a problem and is ranked once", () => {
    const found = priorityOf(models, ["second", "second", "first"]);
    expect(found.problems).toContain('priority: "second" is listed twice.');
    expect(found.ranked.map((one) => one.alias)).toEqual(["second", "first"]);
  });

  test("a file with no priority is ordered by insertion and says so", () => {
    const found = priorityOf(models, undefined);
    expect(found.ranked.map((one) => one.alias)).toEqual(["first", "second"]);
    expect(found.problems).toContain(
      "priority: states no priority order. The page writes it; list every model name in the order the resolver reads.",
    );
  });

  test("an empty allowlist asks for no priority", () => {
    const found = priorityOf({}, undefined);
    expect(found.ranked).toEqual([]);
    expect(found.problems).toEqual([]);
  });
});
