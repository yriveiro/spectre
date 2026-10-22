import { describe, expect, test } from "bun:test";
import type { Model } from "@opencode/schema/model";
import { check } from "../../tools/definitions/routing/check";
import type { Tables } from "../../tools/definitions/routing/types";
import { CATALOGUE } from "./fixture";

const catalogue = CATALOGUE as unknown as ReadonlyArray<Model.Info>;

/** A model that declares `max`, so an effort the base catalogue cannot name is testable. */
const MAXI: Model.Info = {
  providerID: "acme",
  id: "falcon-maximum",
  variants: [{ id: "max" }],
} as unknown as Model.Info;

/** A model that declares only `turbo`, a name the known order cannot rank. */
const TURBO: Model.Info = {
  providerID: "acme",
  id: "falcon-turbo",
  variants: [{ id: "turbo" }],
} as unknown as Model.Info;

/** A model that declares `low` and `medium`, so a step-up requirement is testable. */
const MID: Model.Info = {
  providerID: "acme",
  id: "falcon-mid",
  variants: [{ id: "low" }, { id: "medium" }],
} as unknown as Model.Info;

const tables = (
  models: Record<string, string>,
  profiles: Record<
    string,
    { model?: string | string[]; effort?: string; why?: string; agent?: string }
  > = {},
): Tables => ({
  provider: undefined,
  judge: undefined,
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
    const found = run(tables({ light: "acme/falcon-mini" }));
    expect(found.problems).toEqual([]);
    expect(found.models).toEqual([{ name: "light", model: "acme/falcon-mini" }]);
  });

  test("a ref with a variant keeps it in the string", () => {
    const found = run(tables({ light: "acme/falcon-mini#high" }));
    expect(found.models.map((one) => one.model)).toEqual(["acme/falcon-mini#high"]);
  });

  test("a ref of the wrong shape is reported and the model left out", () => {
    const found = run(tables({ light: "no-provider" }));
    expect(found.models).toEqual([]);
    expect(found.problems).toHaveLength(1);
    expect(found.problems[0]).toContain("models.light");
    expect(found.problems[0]).toContain("Invalid model reference");
  });

  test("a ref that is not in the catalogue is reported against the allowlist", () => {
    const found = run(tables({ spark: "acme/falcon-mini", ghost: "acme/falcon-ghost" }));
    expect(found.problems[0]).toContain("models.ghost");
    expect(found.problems[0]).toContain("Allowed: spark (acme/falcon-mini)");
  });

  test("the allowlist is the list, so a big catalogue does not widen it", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      providerID: "other",
      id: `m${i}`,
      variants: [],
    })) as unknown as ReadonlyArray<Model.Info>;
    const found = run(tables({ spark: "acme/falcon-mini", ghost: "other/nope" }), [
      ...catalogue,
      ...many,
    ]);
    expect(found.problems[0]).toContain("Allowed: spark (acme/falcon-mini)");
    expect(found.problems[0]).not.toContain("other/m0");
    expect(found.problems[0]).not.toContain("more");
  });

  test("an allowlist with nothing resolved says none", () => {
    const found = run(tables({ ghost: "acme/falcon-ghost" }));
    expect(found.problems[0]).toContain("Allowed: none");
  });

  test("a variant the model does not have is reported with the ones it does", () => {
    const found = run(tables({ light: "acme/falcon-mini#extreme" }));
    expect(found.models).toEqual([]);
    expect(found.problems[0]).toContain('"extreme" is not a variant');
    expect(found.problems[0]).toContain("Variants: none, high");
  });

  test("a model with no variants at all says none", () => {
    const found = run(tables({ gpt: "opencode/gpt-5#high" }));
    expect(found.problems[0]).toContain("Variants: none");
  });

  test("every check collects rather than stopping at the first", () => {
    const found = run(tables({ a: "nope", b: "acme/imaginary", c: "acme/falcon-mini" }));
    expect(found.problems).toHaveLength(2);
    expect(found.models.map((one) => one.name)).toEqual(["c"]);
  });

  test("the unresolved list does not depend on the order of the file", () => {
    const first = run(tables({ ghost: "acme/imaginary", spark: "acme/falcon-mini" }));
    const second = run(tables({ spark: "acme/falcon-mini", ghost: "acme/imaginary" }));
    expect(first.problems).toEqual(second.problems);
  });

  describe("the alias charset", () => {
    test("an alias the standard does not allow is named and left out", () => {
      const found = run(tables({ Light: "acme/falcon-mini" }));
      expect(found.models).toEqual([]);
      expect(found.problems).toHaveLength(1);
      expect(found.problems[0]).toContain("models.Light");
      expect(found.problems[0]).toContain("not an alias");
      expect(found.problems[0]).toContain("^[a-z0-9][a-z0-9-]*$");
    });

    test("a leading dash is refused too", () => {
      const found = run(tables({ "-light": "acme/falcon-mini" }));
      expect(found.problems[0]).toContain("models.-light");
    });

    test("a legal alias passes, so the charset is not wider than the standard", () => {
      const found = run(tables({ "light-2": "acme/falcon-mini" }));
      expect(found.problems).toEqual([]);
      expect(found.models.map((one) => one.name)).toEqual(["light-2"]);
    });

    test("a profile naming a refused alias is skipped rather than reported twice", () => {
      const found = run(tables({ Light: "acme/falcon-mini" }, { x: { model: "Light", why: "w" } }));
      expect(found.problems).toHaveLength(1);
      expect(found.problems[0]).toContain("models.Light");
    });
  });

  describe("the requirement", () => {
    test("a profile with neither an effort nor a pin states no requirement", () => {
      const found = run(tables({ light: "acme/falcon-mini" }, { empty: { why: "w" } }));
      expect(found.profiles).toEqual([]);
      expect(found.problems).toHaveLength(1);
      expect(found.problems[0]).toContain("profiles.empty");
      expect(found.problems[0]).toContain("states no requirement");
    });

    test("an effort the catalogue carries and an allowed model reaches is fine", () => {
      const found = run(tables({ light: "acme/falcon-mini" }, { explorer: { effort: "high" } }));
      expect(found.problems).toEqual([]);
      expect(found.profiles.map((one) => one.name)).toEqual(["explorer"]);
    });

    test("an effort no model in the catalogue declares names the profile and the effort", () => {
      const found = run(tables({ light: "acme/falcon-mini" }, { explorer: { effort: "medium" } }));
      expect(found.profiles).toEqual([]);
      expect(found.problems).toHaveLength(1);
      expect(found.problems[0]).toContain("profiles.explorer.effort");
      expect(found.problems[0]).toContain('"medium"');
    });

    test("an effort no allowed model reaches names the highest rung each one does", () => {
      // `max` is declared by MAXI, so the catalogue half passes. Neither allowed
      // model reaches it, so the capacity of each is named instead of silence.
      const found = run(
        tables(
          { light: "acme/falcon-mini", gpt: "opencode/gpt-5" },
          { explorer: { effort: "max" } },
        ),
        [...catalogue, MAXI],
      );
      expect(found.profiles).toEqual([]);
      expect(found.problems).toHaveLength(1);
      expect(found.problems[0]).toContain('profiles.explorer.effort: "max"');
      expect(found.problems[0]).toContain("light (acme/falcon-mini) reaches high");
      expect(found.problems[0]).toContain("gpt (opencode/gpt-5) reaches nothing");
    });

    test("a model whose ladder the order cannot rank says so", () => {
      const found = run(tables({ turbo: "acme/falcon-turbo" }, { explorer: { effort: "max" } }), [
        ...catalogue,
        MAXI,
        TURBO,
      ]);
      expect(found.problems[0]).toContain(
        "turbo (acme/falcon-turbo) reaches nothing the effort order ranks",
      );
    });

    test("an unknown effort name is exact match, and a model that declares it qualifies", () => {
      const found = run(tables({ turbo: "acme/falcon-turbo" }, { explorer: { effort: "turbo" } }), [
        ...catalogue,
        TURBO,
      ]);
      expect(found.problems).toEqual([]);
      expect(found.profiles.map((one) => one.name)).toEqual(["explorer"]);
    });

    test("an unknown effort name a different model declares is out of reach for this one", () => {
      // `turbo` is declared in the catalogue, but the allowed model cannot serve
      // it and cannot step up to it, because an unknown name is never a step up.
      const found = run(tables({ light: "acme/falcon-mini" }, { explorer: { effort: "turbo" } }), [
        ...catalogue,
        TURBO,
      ]);
      expect(found.profiles).toEqual([]);
      expect(found.problems[0]).toContain('"turbo" is an effort no allowed model reaches');
    });

    test("an effort is reachable when an allowed model steps up, and the check says nothing", () => {
      // `medium` is declared by MID, so the catalogue half passes. `light` holds
      // no medium rung but holds `high`, which is at or above it, so it
      // qualifies and the check stays quiet.
      const found = run(tables({ light: "acme/falcon-mini" }, { explorer: { effort: "medium" } }), [
        ...catalogue,
        MID,
      ]);
      expect(found.problems).toEqual([]);
      expect(found.profiles.map((one) => one.name)).toEqual(["explorer"]);
    });

    test("a profile with a pin and an effort is legal, and neither check objects to the pair", () => {
      const found = run(
        tables(
          { light: "acme/falcon-mini" },
          { worker: { effort: "high", model: "light", why: "w" } },
        ),
      );
      expect(found.problems).toEqual([]);
      expect(found.profiles).toEqual([
        {
          name: "worker",
          models: [{ name: "light", model: "acme/falcon-mini" }],
          agent: "spectre",
          why: "w",
        },
      ]);
    });

    test("a profile with a pin alone is legal, as it was before the effort existed", () => {
      const found = run(
        tables({ light: "acme/falcon-mini" }, { worker: { model: "light", why: "w" } }),
      );
      expect(found.problems).toEqual([]);
    });

    test("an effort beside a broken allowlist is still reported, and says no model is allowed", () => {
      const found = run(tables({ ghost: "acme/imaginary" }, { x: { effort: "high" } }));
      expect(found.problems.find((one) => one.includes("profiles.x.effort"))).toContain(
        "No model is allowed.",
      );
    });

    test("an effort with an empty allowlist reports the same", () => {
      const found = run(tables({}, { x: { effort: "high" } }));
      expect(found.problems[0]).toContain("No model is allowed.");
    });
  });

  test("a profile naming a model that is not a name is reported with the names", () => {
    const found = run(
      tables(
        { light: "acme/falcon-mini" },
        {
          explorer: { model: "heavy", why: "w" },
        },
      ),
    );
    expect(found.profiles).toEqual([]);
    expect(found.problems[0]).toContain('"heavy" is not a name in models');
    expect(found.problems[0]).toContain("Names: light");
  });

  test("a profile whose model failed is not reported a second time", () => {
    const found = run(tables({ light: "nope" }, { explorer: { model: "light", why: "w" } }));
    expect(found.problems).toHaveLength(1);
    expect(found.problems[0]).toContain("models.light");
  });

  test("a profile with no agent is given the default", () => {
    const found = run(
      tables(
        { light: "acme/falcon-mini" },
        {
          explorer: { model: "light", why: "w" },
        },
      ),
    );
    expect(found.profiles).toEqual([
      {
        name: "explorer",
        models: [{ name: "light", model: "acme/falcon-mini" }],
        agent: "spectre",
        why: "w",
      },
    ]);
  });

  test("a profile that names a spectre agent is left alone", () => {
    const found = run(
      tables(
        { light: "acme/falcon-mini" },
        {
          reviewer: { model: "light", why: "w", agent: "sicko" },
        },
      ),
    );
    expect(found.profiles.map((one) => one.agent)).toEqual(["sicko"]);
  });

  test("an agent that is not a spectre agent is refused, naming the ones that are", () => {
    const found = run(
      tables(
        { light: "acme/falcon-mini" },
        {
          explorer: { model: "light", why: "w", agent: "explore" },
        },
      ),
    );
    expect(found.profiles).toEqual([]);
    expect(found.problems).toHaveLength(1);
    expect(found.problems[0]).toContain('"explore" is not a spectre agent');
    expect(found.problems[0]).toContain("Spectre agents: spectre, sicko");
  });

  test("a misspelled spectre agent is caught here, not at spawn", () => {
    const found = run(
      tables(
        { light: "acme/falcon-mini" },
        {
          reviewer: { model: "light", why: "w", agent: "sickoo" },
        },
      ),
    );
    expect(found.problems[0]).toContain('"sickoo" is not a spectre agent');
  });

  test("the default agent is checked too, so a bad DEFAULT_AGENT cannot slip through", () => {
    const found = check(
      tables(
        { light: "acme/falcon-mini" },
        {
          explorer: { model: "light", why: "w" },
        },
      ),
      catalogue,
      "general",
      AGENTS,
    );
    expect(found.problems[0]).toContain('"general" is not a spectre agent');
  });

  test("a profile may name several models, and the order is kept", () => {
    const found = run(
      tables(
        { cheap: "acme/falcon-mini", deep: "acme/falcon-max" },
        { refactor: { model: ["deep", "cheap"], why: "w" } },
      ),
    );
    expect(found.problems).toEqual([]);
    expect(found.profiles[0]?.models).toEqual([
      { name: "deep", model: "acme/falcon-max" },
      { name: "cheap", model: "acme/falcon-mini" },
    ]);
  });

  test("a profile with one bad candidate is withheld, not half returned", () => {
    const found = run(
      tables(
        { cheap: "acme/falcon-mini", ghost: "acme/imaginary" },
        { refactor: { model: ["cheap", "ghost"], why: "w" } },
      ),
    );
    expect(found.profiles).toEqual([]);
    expect(found.problems).toHaveLength(1);
    expect(found.problems[0]).toContain("models.ghost");
  });
});
