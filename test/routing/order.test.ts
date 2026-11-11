import { describe, expect, test } from "bun:test";
import { crosscheckOf, priorityOf } from "../../tools/definitions/routing/order";

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

describe("crosscheckOf", () => {
  test("a file with no crosscheck list falls back to the priority order", () => {
    const found = crosscheckOf(models, undefined, ["second", "first"]);
    expect(found.listed).toEqual(["second", "first"]);
    expect(found.problems).toEqual([]);
  });

  test("the crosscheck list keeps its own order", () => {
    const found = crosscheckOf(models, ["first", "second"], ["second", "first"]);
    expect(found.listed).toEqual(["first", "second"]);
    expect(found.problems).toEqual([]);
  });

  test("a model that is not in the allowlist is a problem", () => {
    const found = crosscheckOf(models, ["second", "ghost"], ["first", "second"]);
    expect(found.listed).toEqual(["second"]);
    expect(found.problems).toContain(
      'crosscheck: "ghost" is not a model in models. Names: first, second',
    );
  });

  test("a repeated name is a problem and is listed once", () => {
    const found = crosscheckOf(models, ["second", "second"], ["first", "second"]);
    expect(found.listed).toEqual(["second"]);
    expect(found.problems).toContain('crosscheck: "second" is listed twice.');
  });

  test("an empty list is a decision, not a fallback", () => {
    const found = crosscheckOf(models, [], ["first", "second"]);
    expect(found.listed).toEqual([]);
    expect(found.problems).toEqual([]);
  });
});
