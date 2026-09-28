import { describe, expect, test } from "bun:test";
import type { Model } from "@opencode/schema/model";
import { check } from "../../tools/definitions/routing/check";
import type { Tables } from "../../tools/definitions/routing/types";
import { CATALOGUE } from "./fixture";

const catalogue = CATALOGUE as unknown as ReadonlyArray<Model.Info>;

const tables = (
  models: Record<string, string>,
  profiles: Record<string, { model: string | string[]; why: string; agent?: string }> = {},
): Tables => ({
  models,
  profiles: Object.fromEntries(
    Object.entries(profiles).map(([name, entry]) => [
      name,
      { ...entry, model: typeof entry.model === "string" ? [entry.model] : entry.model },
    ]),
  ),
});

const AGENTS = ["spectre", "sicko"];

const run = (given: Tables, models: ReadonlyArray<Model.Info> = catalogue) =>
  check(given, models, "spectre", AGENTS);

describe("check", () => {
  test("a ref that exists becomes a row, with no variant suffix", () => {
    const found = run(tables({ haiku: "anthropic/claude-haiku-4-5" }));
    expect(found.problems).toEqual([]);
    expect(found.models).toEqual([
      { name: "haiku", model: "anthropic/claude-haiku-4-5" },
    ]);
  });

  test("a ref with a variant keeps it in the string", () => {
    const found = run(tables({ haiku: "anthropic/claude-haiku-4-5#high" }));
    expect(found.models.map((one) => one.model)).toEqual([
      "anthropic/claude-haiku-4-5#high",
    ]);
  });

  test("a ref of the wrong shape is reported and the model left out", () => {
    const found = run(tables({ haiku: "claude-haiku-4-5" }));
    expect(found.models).toEqual([]);
    expect(found.problems).toHaveLength(1);
    expect(found.problems[0]).toContain("models.haiku");
    expect(found.problems[0]).toContain("Invalid model reference");
  });

  test("a ref that is not in the catalogue is reported against the allowlist", () => {
    const found = run(tables({ spark: "anthropic/claude-haiku-4-5", ghost: "anthropic/claude-imaginary-9" }));
    expect(found.problems[0]).toContain("models.ghost");
    expect(found.problems[0]).toContain("Allowed: spark (anthropic/claude-haiku-4-5)");
  });

  test("the allowlist is the list, so a big catalogue does not widen it", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      providerID: "other",
      id: `m${i}`,
      variants: [],
    })) as unknown as ReadonlyArray<Model.Info>;
    const found = run(
      tables({ spark: "anthropic/claude-haiku-4-5", ghost: "other/nope" }),
      [...catalogue, ...many],
    );
    expect(found.problems[0]).toContain("Allowed: spark (anthropic/claude-haiku-4-5)");
    expect(found.problems[0]).not.toContain("other/m0");
    expect(found.problems[0]).not.toContain("more");
  });

  test("an allowlist with nothing resolved says none", () => {
    const found = run(tables({ ghost: "anthropic/claude-imaginary-9" }));
    expect(found.problems[0]).toContain("Allowed: none");
  });

  test("a variant the model does not have is reported with the ones it does", () => {
    const found = run(tables({ haiku: "anthropic/claude-haiku-4-5#extreme" }));
    expect(found.models).toEqual([]);
    expect(found.problems[0]).toContain('"extreme" is not a variant');
    expect(found.problems[0]).toContain("Variants: none, high");
  });

  test("a model with no variants at all says none", () => {
    const found = run(tables({ gpt: "opencode/gpt-5#high" }));
    expect(found.problems[0]).toContain("Variants: none");
  });

  test("every check collects rather than stopping at the first", () => {
    const found = run(
      tables({ a: "nope", b: "anthropic/imaginary", c: "anthropic/claude-haiku-4-5" }),
    );
    expect(found.problems).toHaveLength(2);
    expect(found.models.map((one) => one.name)).toEqual(["c"]);
  });

  test("the unresolved list does not depend on the order of the file", () => {
    const first = run(tables({ ghost: "anthropic/imaginary", spark: "anthropic/claude-haiku-4-5" }));
    const second = run(tables({ spark: "anthropic/claude-haiku-4-5", ghost: "anthropic/imaginary" }));
    expect(first.problems).toEqual(second.problems);
  });

  test("a profile naming a model that is not a name is reported with the names", () => {
    const found = run(
      tables({ haiku: "anthropic/claude-haiku-4-5" }, {
        explorer: { model: "opus", why: "w" },
      }),
    );
    expect(found.profiles).toEqual([]);
    expect(found.problems[0]).toContain('"opus" is not a name in models');
    expect(found.problems[0]).toContain("Names: haiku");
  });

  test("a profile whose model failed is not reported a second time", () => {
    const found = run(
      tables({ haiku: "nope" }, { explorer: { model: "haiku", why: "w" } }),
    );
    expect(found.problems).toHaveLength(1);
    expect(found.problems[0]).toContain("models.haiku");
  });

  test("a profile with no agent is given the default", () => {
    const found = run(
      tables({ haiku: "anthropic/claude-haiku-4-5" }, {
        explorer: { model: "haiku", why: "w" },
      }),
    );
    expect(found.profiles).toEqual([
      {
        name: "explorer",
        models: [{ name: "haiku", model: "anthropic/claude-haiku-4-5" }],
        agent: "spectre",
        why: "w",
      },
    ]);
  });

  test("a profile that names a spectre agent is left alone", () => {
    const found = run(
      tables({ haiku: "anthropic/claude-haiku-4-5" }, {
        reviewer: { model: "haiku", why: "w", agent: "sicko" },
      }),
    );
    expect(found.profiles.map((one) => one.agent)).toEqual(["sicko"]);
  });

  test("an agent that is not a spectre agent is refused, naming the ones that are", () => {
    const found = run(
      tables({ haiku: "anthropic/claude-haiku-4-5" }, {
        explorer: { model: "haiku", why: "w", agent: "explore" },
      }),
    );
    expect(found.profiles).toEqual([]);
    expect(found.problems).toHaveLength(1);
    expect(found.problems[0]).toContain('"explore" is not a spectre agent');
    expect(found.problems[0]).toContain("Spectre agents: spectre, sicko");
  });

  test("a misspelled spectre agent is caught here, not at spawn", () => {
    const found = run(
      tables({ haiku: "anthropic/claude-haiku-4-5" }, {
        reviewer: { model: "haiku", why: "w", agent: "sickoo" },
      }),
    );
    expect(found.problems[0]).toContain('"sickoo" is not a spectre agent');
  });

  test("the default agent is checked too, so a bad DEFAULT_AGENT cannot slip through", () => {
    const found = check(
      tables({ haiku: "anthropic/claude-haiku-4-5" }, {
        explorer: { model: "haiku", why: "w" },
      }),
      catalogue,
      "general",
      AGENTS,
    );
    expect(found.problems[0]).toContain('"general" is not a spectre agent');
  });

  test("a profile may name several models, and the order is kept", () => {
    const found = run(
      tables(
        { cheap: "anthropic/claude-haiku-4-5", deep: "anthropic/claude-opus-4-1" },
        { refactor: { model: ["deep", "cheap"], why: "w" } },
      ),
    );
    expect(found.problems).toEqual([]);
    expect(found.profiles[0]?.models).toEqual([
      { name: "deep", model: "anthropic/claude-opus-4-1" },
      { name: "cheap", model: "anthropic/claude-haiku-4-5" },
    ]);
  });

  test("a profile with one bad candidate is withheld, not half returned", () => {
    const found = run(
      tables(
        { cheap: "anthropic/claude-haiku-4-5", ghost: "anthropic/imaginary" },
        { refactor: { model: ["cheap", "ghost"], why: "w" } },
      ),
    );
    expect(found.profiles).toEqual([]);
    expect(found.problems).toHaveLength(1);
    expect(found.problems[0]).toContain("models.ghost");
  });
});
