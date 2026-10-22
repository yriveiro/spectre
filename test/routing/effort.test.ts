import { describe, expect, test } from "bun:test";
import {
  effortOf,
  type Fit,
  fit,
  KNOWN_ORDER,
  type Ladder,
  ladderOf,
  rungs,
} from "../../tools/definitions/routing/effort";

/** A ladder from its variant ids, the way the catalogue declares them. */
const ladder = (...ids: ReadonlyArray<string>): Ladder => ladderOf(ids.map((id) => ({ id })));

/** The expected fit of a ladder that meets the requirement, exactly or above it. */
const rung = (want: string, at: string, below?: string): Fit => ({
  kind: "rung",
  at: effortOf(at),
  want: effortOf(want),
  below: below === undefined ? undefined : effortOf(below),
});

/** The expected fit of a ladder that cannot reach the requirement. */
const short = (best?: string): Fit => ({
  kind: "short",
  best: best === undefined ? undefined : effortOf(best),
});

/** The expected fit of a model with no thinking control. */
const FLOOR: Fit = { kind: "floor" };

describe("the known order", () => {
  test("the order ascends from none to max", () => {
    expect([...KNOWN_ORDER]).toEqual(["none", "minimal", "low", "medium", "high", "xhigh", "max"]);
  });

  test("every known name carries the rank of its place in the order", () => {
    expect(KNOWN_ORDER.map((name) => effortOf(name))).toEqual(
      KNOWN_ORDER.map((name, rank) => ({ kind: "known", name, rank })),
    );
  });

  test("a name outside the order is unknown and carries no rank", () => {
    expect(effortOf("turbo")).toEqual({ kind: "unknown", name: "turbo" });
  });

  test("a name is matched exactly, so a different case is an unknown name", () => {
    // The catalogue's names are lower case. A requirement is the name the
    // provider wrote, and no other spelling of it.
    expect(effortOf("High").kind).toBe("unknown");
    expect(effortOf(" high").kind).toBe("unknown");
    expect(effortOf("").kind).toBe("unknown");
  });

  test("a name that collides with an object key is unknown, not ranked", () => {
    // A lookup through an object would find a function here and rank it.
    expect(effortOf("toString").kind).toBe("unknown");
    expect(effortOf("constructor").kind).toBe("unknown");
    expect(effortOf("__proto__").kind).toBe("unknown");
  });
});

describe("ladderOf", () => {
  test("the rungs are sorted by the known order, not by the array order", () => {
    // The provider's taste, not a ladder: a resolver that trusted this order
    // would step down from high to low.
    expect(ladder("high", "low").ranked).toEqual(["low", "high"]);
  });

  test("no variants at all is an empty ladder, not a failure", () => {
    expect(ladderOf([])).toEqual({ ranked: [], unranked: [] });
  });

  test("a toggle ladder ranks none and keeps thinking apart", () => {
    // `packages/core/src/variant.ts:52` at `v2.1.1` declares a toggle as
    // `none` and `thinking`, and `thinking` is not a name the order ranks.
    expect(ladder("none", "thinking")).toEqual({ ranked: ["none"], unranked: ["thinking"] });
  });

  test("a toggle ladder reads the same in either declared order", () => {
    expect(ladder("thinking", "none")).toEqual({ ranked: ["none"], unranked: ["thinking"] });
  });

  test("a provider's own name is kept apart from the ranked rungs", () => {
    expect(ladder("turbo", "high", "low")).toEqual({
      ranked: ["low", "high"],
      unranked: ["turbo"],
    });
  });

  test("an id declared twice is one rung", () => {
    expect(ladder("low", "low", "high")).toEqual({ ranked: ["low", "high"], unranked: [] });
  });
});

describe("rungs", () => {
  test("the ranked rungs come first and the unranked ones last", () => {
    expect(rungs(ladder("turbo", "high", "low"))).toEqual(["low", "high", "turbo"]);
  });

  test("an empty ladder reads as no rungs", () => {
    expect(rungs(ladderOf([]))).toEqual([]);
  });
});

describe("fit", () => {
  test("a requirement the ladder holds is met at that rung", () => {
    expect(fit(ladder("low", "high", "max"), effortOf("low"))).toEqual(rung("low", "low"));
  });

  test("the gap case: medium on low, high, max steps up to high and names low below it", () => {
    expect(fit(ladder("low", "high", "max"), effortOf("medium"))).toEqual(
      rung("medium", "high", "low"),
    );
  });

  test("the lowest rung at or above the requirement is the one taken", () => {
    // Not the highest rung: the least thinking that still clears the bar.
    expect(fit(ladder("low", "high", "max"), effortOf("xhigh"))).toEqual(
      rung("xhigh", "max", "high"),
    );
  });

  test("a ladder whose ranked rungs are out of order answers the same", () => {
    // `ladderOf` sorts, but the search reads the ranks of the rungs. A ladder
    // built anywhere else cannot make the resolver step down.
    const hand: Ladder = { ranked: ["high", "low", "max"], unranked: [] };
    expect(fit(hand, effortOf("medium"))).toEqual(rung("medium", "high", "low"));
    expect(fit(hand, effortOf("minimal"))).toEqual(rung("minimal", "low"));
    expect(fit({ ranked: ["high", "low"], unranked: [] }, effortOf("max"))).toEqual(short("high"));
  });

  test("a ladder that starts above the requirement steps up from no rung", () => {
    // `below` is undefined because the ladder holds no rung under the one used,
    // and the report names that as a step up from nothing.
    expect(fit(ladder("high", "max"), effortOf("low"))).toEqual(rung("low", "high"));
  });

  test("a ladder that stops under the requirement is short and carries its highest rung", () => {
    expect(fit(ladder("low", "high"), effortOf("max"))).toEqual(short("high"));
  });

  test("a ladder with no rungs at all is a floor", () => {
    expect(fit(ladderOf([]), effortOf("high"))).toEqual(FLOOR);
  });

  test("a floor is a floor for a requirement of none", () => {
    expect(fit(ladderOf([]), effortOf("none"))).toEqual(FLOOR);
  });

  test("a floor is a floor for an unknown requirement too", () => {
    // The model has no thinking control, so the requirement is not read at all.
    expect(fit(ladderOf([]), effortOf("turbo"))).toEqual(FLOOR);
  });

  test("none is the floor requirement: a ladder with rungs is spent at its lowest rung", () => {
    // The open question in `features/routing.md` is settled here as the floor.
    // A profile that asks for `none` gets the least the model can think, which
    // is its lowest rung, and the requirement and the rung differ so the
    // report says it stepped up.
    expect(fit(ladder("low", "high", "max"), effortOf("none"))).toEqual(rung("none", "low"));
  });

  test("none on a toggle ladder is the off switch, not a step up", () => {
    expect(fit(ladder("none", "thinking"), effortOf("none"))).toEqual(rung("none", "none"));
  });

  test("an unknown requirement is met by a rung of the same name", () => {
    expect(fit(ladder("low", "turbo", "high"), effortOf("turbo"))).toEqual(rung("turbo", "turbo"));
  });

  test("an unknown requirement is never met by a step up", () => {
    // The ladder reaches high, and that does not qualify a requirement nobody
    // can rank. No nearest-guessing on a name the order does not know.
    expect(fit(ladder("low", "high"), effortOf("turbo"))).toEqual(short("high"));
  });

  test("an unknown requirement on a ladder with no ranked rung is short with nothing to report", () => {
    expect(fit(ladder("thinking"), effortOf("turbo"))).toEqual(short());
  });

  test("an unranked rung does not join the ordered search", () => {
    // `turbo` is not a position, so a known requirement ignores it and takes
    // the ranked rung above.
    expect(fit(ladder("turbo", "max"), effortOf("low"))).toEqual(rung("low", "max"));
  });

  test("a known requirement is not met by an unranked rung alone", () => {
    expect(fit(ladder("thinking"), effortOf("low"))).toEqual(short());
  });
});

/**
 * The six ladders of `features/routing.md`, read from the catalogue. The order
 * is `none < minimal < low < medium < high < xhigh < max`, so `minimal` sits
 * under `low` and a ladder that starts at `minimal` still meets `low` at `low`.
 */
const LADDERS = {
  "muse-spark-1.3-contributor": ["minimal", "low", "medium", "high", "xhigh"],
  "minimax-m3.1-flash-free": ["low", "medium", "high", "xhigh", "max"],
  "glm-5.3-flash": ["low", "high", "max"],
  "deepseek-v4.1-flash": ["low", "high", "max"],
  "deepseek-v4-pro": ["high", "max"],
  "kimi-k3": ["max"],
} as const;

type Model = keyof typeof LADDERS;

const MODELS = Object.keys(LADDERS) as Array<Model>;

const of = (model: Model): Ladder => ladder(...LADDERS[model]);

describe("the six ladders of the feature file", () => {
  const expected: Record<Model, Record<"none" | "low" | "high" | "max", Fit>> = {
    "muse-spark-1.3-contributor": {
      none: rung("none", "minimal"),
      low: rung("low", "low", "minimal"),
      high: rung("high", "high", "medium"),
      max: short("xhigh"),
    },
    "minimax-m3.1-flash-free": {
      none: rung("none", "low"),
      low: rung("low", "low"),
      high: rung("high", "high", "medium"),
      max: rung("max", "max", "xhigh"),
    },
    "glm-5.3-flash": {
      none: rung("none", "low"),
      low: rung("low", "low"),
      high: rung("high", "high", "low"),
      max: rung("max", "max", "high"),
    },
    "deepseek-v4.1-flash": {
      none: rung("none", "low"),
      low: rung("low", "low"),
      high: rung("high", "high", "low"),
      max: rung("max", "max", "high"),
    },
    "deepseek-v4-pro": {
      none: rung("none", "high"),
      low: rung("low", "high"),
      high: rung("high", "high"),
      max: rung("max", "max", "high"),
    },
    "kimi-k3": {
      none: rung("none", "max"),
      low: rung("low", "max"),
      high: rung("high", "max"),
      max: rung("max", "max"),
    },
  };

  for (const model of MODELS) {
    describe(model, () => {
      test("none is spent at the lowest rung, and the requirement steps up", () => {
        expect(fit(of(model), effortOf("none"))).toEqual(expected[model].none);
      });

      test("low takes the lowest rung at or above low", () => {
        expect(fit(of(model), effortOf("low"))).toEqual(expected[model].low);
      });

      test("high takes the lowest rung at or above high", () => {
        expect(fit(of(model), effortOf("high"))).toEqual(expected[model].high);
      });

      test("max is met at max, or says how far short the ladder is", () => {
        expect(fit(of(model), effortOf("max"))).toEqual(expected[model].max);
      });
    });
  }

  test("only one of the six ladders stops short of max", () => {
    const reaching = MODELS.filter((model) => fit(of(model), effortOf("max")).kind === "rung");
    expect(reaching).toEqual([
      "minimax-m3.1-flash-free",
      "glm-5.3-flash",
      "deepseek-v4.1-flash",
      "deepseek-v4-pro",
      "kimi-k3",
    ]);
  });

  test("the ladders are ragged, so one requirement meets a different rung on each", () => {
    // Raising the effort moves the answer, and a model that cannot follow a
    // raised requirement is reported short rather than dropped in silence.
    const atLow = MODELS.map((model) => {
      const got = fit(of(model), effortOf("low"));
      return got.kind === "rung" ? got.at.name : "short";
    });
    expect(atLow).toEqual(["low", "low", "low", "low", "high", "max"]);

    const atMax = MODELS.map((model) => {
      const got = fit(of(model), effortOf("max"));
      return got.kind === "rung" ? got.at.name : "short";
    });
    expect(atMax).toEqual(["short", "max", "max", "max", "max", "max"]);
  });
});
