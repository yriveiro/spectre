import { describe, expect, test } from "bun:test";
import { Model } from "@opencode/schema/model";
import { Money } from "@opencode/schema/money";
import { Provider } from "@opencode/schema/provider";
import { candidates, isFree, known, ladder } from "../../tools/definitions/routing/catalogue";
import { effortOf, rungs } from "../../tools/definitions/routing/effort";
import { resolve, rungFor } from "../../tools/definitions/routing/resolve";
import type { Allowed, Candidate, ProfileEntry } from "../../tools/definitions/routing/types";
import { CATALOGUE } from "./fixture";

/**
 * The catalogue read and the selection policy, proved against the fixture's own
 * catalogue and the six ladders of `features/routing.md`.
 *
 * A test here names the case it proves, because the policy is one rule with
 * several ways to break it: the order, the pin, the family, the free
 * preference, and a requirement nothing reaches.
 */

/** A catalogue row the test builds, with the host's own defaults under it. */
type Given = {
  readonly providerID: string;
  readonly id: string;
  readonly name?: string;
  readonly family?: string;
  readonly variants?: ReadonlyArray<string>;
  readonly cost?: { readonly input: number; readonly output: number };
  readonly enabled?: boolean;
  readonly status?: "alpha" | "beta" | "deprecated" | "active";
  readonly tools?: boolean;
};

const usd = (value: number) => Money.USDPerMillionTokens.make(value);

const row = (given: Given): Model.Info => {
  const base = Model.Info.default(Provider.ID.make(given.providerID), Model.ID.make(given.id));
  const input = given.cost?.input ?? 0;
  const output = given.cost?.output ?? 0;

  return {
    ...base,
    name: given.name ?? given.id,
    family: given.family === undefined ? undefined : Model.Family.make(given.family),
    variants: (given.variants ?? []).map((id) => ({ id: Model.VariantID.make(id) })),
    // The base entry first, then a context tier at twice the price. The base
    // tier is the one without a tier size, so a reader that takes the first
    // entry and a reader that takes the untiered one agree only if the rule
    // is stated. Here they disagree on purpose.
    cost:
      given.cost === undefined
        ? []
        : [
            { input: usd(input), output: usd(output), cache: { read: usd(0), write: usd(0) } },
            {
              tier: { type: "context", size: 200_000 },
              input: usd(input * 2),
              output: usd(output * 2),
              cache: { read: usd(0), write: usd(0) },
            },
          ],
    enabled: given.enabled ?? true,
    status: given.status ?? "active",
    capabilities: { ...base.capabilities, tools: given.tools ?? true },
  };
};

/** A row out of the fixture, by id, so this catalogue grows from the one the other tests share. */
const fixture = (id: string) => {
  const found = CATALOGUE.find((one) => one.id === id);
  if (found === undefined) throw new Error(`the fixture has no ${id}`);
  return {
    providerID: found.providerID,
    id: found.id,
    variants: found.variants.map((one) => one.id),
  };
};

/** The fixture's row as it is, which carries only the fields a check reads. */
const thin = (id: string): Model.Info => {
  const found = CATALOGUE.find((one) => one.id === id);
  if (found === undefined) throw new Error(`the fixture has no ${id}`);
  return found as unknown as Model.Info;
};

const FALCON_MINI = row({
  ...fixture("falcon-mini"),
  family: "falcon",
  cost: { input: 1, output: 2 },
});
const FALCON_MAX = row({
  ...fixture("falcon-max"),
  family: "falcon",
  cost: { input: 2, output: 4 },
  enabled: false,
});
const GPT5 = row({
  ...fixture("gpt-5"),
  family: "openai",
  cost: { input: 2, output: 8 },
  status: "deprecated",
});
const PLAIN = row({ providerID: "acme", id: "falcon-plain", family: "falcon", variants: [] });
const MUTE = row({
  providerID: "acme",
  id: "falcon-mute",
  family: "falcon",
  variants: ["high"],
  tools: false,
});
const TURBO = row({
  providerID: "acme",
  id: "falcon-turbo",
  family: "turbo",
  variants: ["turbo", "high"],
});
const LOW = row({
  providerID: "acme",
  id: "falcon-low",
  family: "small",
  cost: { input: 0.1, output: 0.1 },
  variants: ["low"],
});
const NO_FAMILY = row({
  providerID: "acme",
  id: "falcon-nofamily",
  cost: { input: 0.4, output: 0.4 },
  variants: ["high"],
});

/** The six ladders of `features/routing.md`, with the cost the file gives them. */
const MUSE = row({
  providerID: "opencode-go",
  id: "muse-spark-1.3-contributor",
  family: "muse",
  cost: { input: 0.1, output: 0.2 },
  variants: ["minimal", "low", "medium", "high", "xhigh"],
});
const MINIMAX = row({
  providerID: "opencode-go",
  id: "minimax-m3.1-flash-free",
  family: "minimax",
  cost: { input: 0, output: 0 },
  variants: ["low", "medium", "high", "xhigh", "max"],
});
const GLM = row({
  providerID: "opencode-go",
  id: "glm-5.3-flash",
  family: "glm-flash",
  cost: { input: 0.15, output: 0.5 },
  variants: ["low", "high", "max"],
});
const DEEPSEEK = row({
  providerID: "opencode-go",
  id: "deepseek-v4.1-flash",
  family: "deepseek-flash",
  cost: { input: 0.15, output: 0.6 },
  variants: ["low", "high", "max"],
});
const PRO = row({
  providerID: "opencode-go",
  id: "deepseek-v4-pro",
  family: "deepseek-thinking",
  cost: { input: 0.66, output: 1.98 },
  variants: ["high", "max"],
});
const KIMI = row({
  providerID: "opencode-go",
  id: "kimi-k3",
  family: "kimi-k3",
  cost: { input: 3, output: 15 },
  variants: ["max"],
});

const MODELS: ReadonlyArray<Model.Info> = [
  FALCON_MINI,
  FALCON_MAX,
  GPT5,
  PLAIN,
  MUTE,
  TURBO,
  LOW,
  NO_FAMILY,
  MUSE,
  MINIMAX,
  GLM,
  DEEPSEEK,
  PRO,
  KIMI,
];

const allow = (alias: string, ref: string, pinned?: string): Allowed => ({ alias, ref, pinned });

const kept = (
  entries: ReadonlyArray<Allowed>,
  catalogue: ReadonlyArray<Model.Info> = MODELS,
): ReadonlyArray<Candidate> => candidates(entries, catalogue).kept;

describe("known", () => {
  test("a row is reduced to the fields a decision reads", () => {
    expect(known(MUSE)).toEqual({
      providerID: "opencode-go",
      id: "muse-spark-1.3-contributor",
      name: "muse-spark-1.3-contributor",
      family: "muse",
      rungs: ["minimal", "low", "medium", "high", "xhigh"],
      // The base tier, not the tier at twice the price.
      costInput: 0.1,
      costOutput: 0.2,
      enabled: true,
      status: "active",
      tools: true,
    });
  });

  test("the rungs keep the catalogue's order, and the ladder sorts by the known order", () => {
    // The provider's taste is not a ladder. `Known.rungs` reports what the
    // catalogue said, so a page can show it, and `ladder` is what a policy reads.
    const reversed = row({
      providerID: "acme",
      id: "falcon-reversed",
      variants: ["high", "low", "turbo"],
    });
    expect(known(reversed).rungs).toEqual(["high", "low", "turbo"]);
    expect(rungs(ladder(known(reversed)))).toEqual(["low", "high", "turbo"]);
  });

  test("a row with no cost entry costs nothing", () => {
    const bare = row({ providerID: "acme", id: "falcon-bare", variants: ["low"] });
    expect(known(bare).costInput).toBe(0);
    expect(known(bare).costOutput).toBe(0);
    expect(isFree(known(bare))).toBe(true);
  });

  test("a price on one side only is not free", () => {
    const cheap = row({
      providerID: "acme",
      id: "falcon-cheap",
      cost: { input: 0, output: 0.2 },
      variants: ["low"],
    });
    expect(isFree(known(cheap))).toBe(false);
  });

  test("a thin row takes the host's own defaults, so it cannot crash a decision", () => {
    // The fixture's catalogue predates this feature and carries only what a
    // check reads. A normalizer is total: a row that states nothing is read the
    // way `Model.Info.default` reads it.
    const found = known(thin("falcon-mini"));
    expect(found.rungs).toEqual(["none", "high"]);
    expect(found.enabled).toBe(true);
    expect(found.status).toBe("active");
    expect(found.tools).toBe(true);
    expect(found.costInput).toBe(0);
    expect(isFree(found)).toBe(true);
  });
});

describe("candidates", () => {
  test("the order of the file is kept, and the cost never sorts it", () => {
    const found = candidates(
      [
        allow("kimi", "opencode-go/kimi-k3"),
        allow("free", "opencode-go/minimax-m3.1-flash-free"),
        allow("glm", "opencode-go/glm-5.3-flash"),
      ],
      MODELS,
    );
    expect(found.missing).toEqual([]);
    expect(found.kept.map((one) => one.alias)).toEqual(["kimi", "free", "glm"]);
    expect(found.kept.map((one) => one.model.costInput)).toEqual([3, 0, 0.15]);
  });

  test("an entry that cannot be spent is reported with a reason, not dropped", () => {
    const found = candidates(
      [
        allow("ghost", "acme/falcon-ghost"),
        allow("off", "acme/falcon-max"),
        allow("old", "opencode/gpt-5"),
        allow("mute", "acme/falcon-mute"),
        allow("light", "acme/falcon-mini"),
      ],
      MODELS,
    );
    expect(found.kept.map((one) => one.alias)).toEqual(["light"]);
    expect(found.missing.map((one) => one.alias)).toEqual(["ghost", "off", "old", "mute"]);
    expect(found.missing[0]?.reason).toContain("not a model this session can see");
    expect(found.missing[1]?.reason).toContain("is disabled");
    expect(found.missing[2]?.reason).toContain("is deprecated");
    expect(found.missing[3]?.reason).toContain("cannot call tools");
  });

  test("a pinned variant is the only rung, and it stays in the ref", () => {
    expect(kept([allow("light", "acme/falcon-mini#high")])[0]).toMatchObject({
      ref: "acme/falcon-mini#high",
      pinned: "high",
    });

    // The pin field alone is enough, so a caller that split the ref still gets
    // back the exact string the session must pass.
    expect(kept([allow("light", "acme/falcon-mini", "high")])[0]?.ref).toBe(
      "acme/falcon-mini#high",
    );
  });

  test("a variant the model does not declare is missing, with the ones it has", () => {
    const found = candidates([allow("light", "acme/falcon-mini#extreme")], MODELS);
    expect(found.kept).toEqual([]);
    expect(found.missing[0]?.reason).toContain('has no variant "extreme"');
    expect(found.missing[0]?.reason).toContain("Variants: none, high");
  });

  test("a ref of the wrong shape is a reason, not a crash", () => {
    const found = candidates([allow("bad", "no-provider")], MODELS);
    expect(found.kept).toEqual([]);
    expect(found.missing[0]?.reason).toContain("Invalid model reference");
  });
});

describe("resolve: the order", () => {
  test("the first candidate in the file is spent, even when a later one is free", () => {
    const found = resolve(
      "deep",
      { effort: "max" },
      kept([
        allow("kimi", "opencode-go/kimi-k3"),
        allow("free", "opencode-go/minimax-m3.1-flash-free"),
      ]),
      "spectre",
    );
    expect(found.problem).toBeUndefined();
    expect(found.resolution?.primary.alias).toBe("kimi");
    expect(found.resolution?.primary.costInput).toBe(3);
    expect(found.excluded).toEqual([]);
  });

  test("a candidate that cannot reach the requirement is skipped and reports its capacity", () => {
    const found = resolve(
      "thinking",
      { effort: "max" },
      kept([
        allow("muse", "opencode-go/muse-spark-1.3-contributor"),
        allow("kimi", "opencode-go/kimi-k3"),
      ]),
      "spectre",
    );
    expect(found.resolution?.primary.alias).toBe("kimi");
    expect(found.excluded).toHaveLength(1);
    expect(found.excluded[0]).toEqual({
      alias: "muse",
      ref: "opencode-go/muse-spark-1.3-contributor",
      reason: 'cannot reach "max". Its highest rung is "xhigh"',
      rungs: ["minimal", "low", "medium", "high", "xhigh"],
      reaches: "xhigh",
    });
  });

  test("the lowest qualifying rung is spent, and the gap is named", () => {
    const found = resolve(
      "search",
      { effort: "medium" },
      kept([allow("glm", "opencode-go/glm-5.3-flash")]),
      "spectre",
    );
    expect(found.resolution?.primary).toEqual({
      alias: "glm",
      ref: "opencode-go/glm-5.3-flash",
      rung: "high",
      pinned: false,
      steppedUp: true,
      below: "low",
      family: "glm-flash",
      rungs: ["low", "high", "max"],
      costInput: 0.15,
      costOutput: 0.5,
    });
  });

  test("a model with no thinking control is spent for none, and never for an effort", () => {
    const none = resolve(
      "mechanical",
      { effort: "none" },
      kept([allow("plain", "acme/falcon-plain")]),
      "spectre",
    );
    expect(none.problem).toBeUndefined();
    expect(none.resolution?.primary.alias).toBe("plain");
    expect(none.resolution?.primary.rung).toBeUndefined();
    expect(none.resolution?.primary.steppedUp).toBe(false);

    const low = resolve(
      "mechanical",
      { effort: "low" },
      kept([allow("plain", "acme/falcon-plain")]),
      "spectre",
    );
    expect(low.resolution).toBeUndefined();
    expect(low.excluded[0]?.reason).toContain("has no thinking control");
    expect(low.excluded[0]?.reaches).toBeUndefined();
    expect(low.problem).toContain('no allowed model reaches "low"');
  });
});

describe("resolve: the pin", () => {
  test("a pin wins over the requirement, and it is marked pinned", () => {
    const found = resolve(
      "worker",
      { effort: "max", model: ["muse"] },
      kept([
        allow("muse", "opencode-go/muse-spark-1.3-contributor"),
        allow("kimi", "opencode-go/kimi-k3"),
      ]),
      "spectre",
    );
    expect(found.problem).toBeUndefined();
    expect(found.resolution?.primary).toMatchObject({
      alias: "muse",
      rung: undefined,
      pinned: true,
      steppedUp: false,
    });
    // The requirement was skipped, so nothing failed it.
    expect(found.excluded).toEqual([]);
  });

  test("a pin list keeps its own order, not the allowlist's", () => {
    const found = resolve(
      "worker",
      { model: ["minimax", "muse"] },
      kept([
        allow("muse", "opencode-go/muse-spark-1.3-contributor"),
        allow("minimax", "opencode-go/minimax-m3.1-flash-free"),
      ]),
      "spectre",
    );
    expect(found.resolution?.primary.alias).toBe("minimax");
  });

  test("a pinned model uses the profile's effort when the model supports that rung", () => {
    const found = resolve(
      "worker",
      { effort: "low", model: ["glm"] },
      kept([
        allow("muse", "opencode-go/muse-spark-1.3-contributor"),
        allow("glm", "opencode-go/glm-5.3-flash"),
      ]),
      "spectre",
    );
    expect(found.problem).toBeUndefined();
    expect(found.resolution?.primary).toMatchObject({
      alias: "glm",
      ref: "opencode-go/glm-5.3-flash",
      rung: "low",
      pinned: true,
    });
  });

  test("a pinned variant is the rung the pin reports", () => {
    const found = resolve(
      "worker",
      { effort: "max", model: "muse" },
      kept([allow("muse", "opencode-go/muse-spark-1.3-contributor#medium")]),
      "spectre",
    );
    expect(found.resolution?.primary).toMatchObject({
      ref: "opencode-go/muse-spark-1.3-contributor#medium",
      rung: "medium",
      pinned: true,
    });
  });

  test("a pin that names no allowed model is a problem", () => {
    const found = resolve(
      "worker",
      { model: ["ghost"] },
      kept([allow("muse", "opencode-go/muse-spark-1.3-contributor")]),
      "spectre",
    );
    expect(found.resolution).toBeUndefined();
    expect(found.problem).toContain("profiles.worker.model");
    expect(found.problem).toContain('"ghost"');
  });

  test("a profile with no effort and no pin is a problem, not an empty answer", () => {
    const found = resolve("worker", {} as ProfileEntry, kept([]), "spectre");
    expect(found.resolution).toBeUndefined();
    expect(found.problem).toContain("no effort and no model");
  });

  test("a pinned profile still gets the crosscheck it declares", () => {
    const found = resolve(
      "worker",
      { model: ["muse"], crosscheck: { effort: "high" } },
      kept([
        allow("muse", "opencode-go/muse-spark-1.3-contributor"),
        allow("glm", "opencode-go/glm-5.3-flash"),
      ]),
      "spectre",
    );
    expect(found.resolution?.primary).toMatchObject({ alias: "muse", pinned: true });
    expect(found.resolution?.crosscheck?.alias).toBe("glm");
    expect(found.excluded).toEqual([]);
  });

  test("a crosscheck with no effort reads the profile's own", () => {
    const found = resolve(
      "worker",
      { effort: "high", crosscheck: { prefer: "free" } },
      kept([
        allow("glm", "opencode-go/glm-5.3-flash"),
        allow("free", "opencode-go/minimax-m3.1-flash-free"),
      ]),
      "spectre",
    );
    expect(found.resolution?.primary.alias).toBe("glm");
    expect(found.resolution?.crosscheck?.alias).toBe("free");
  });

  test("the agent is the profile's own, or the default", () => {
    const withAgent = resolve(
      "reviewer",
      { effort: "low", agent: "sicko" },
      kept([allow("glm", "opencode-go/glm-5.3-flash")]),
      "spectre",
    );
    expect(withAgent.resolution?.agent).toBe("sicko");

    const without = resolve(
      "worker",
      { effort: "low" },
      kept([allow("glm", "opencode-go/glm-5.3-flash")]),
      "spectre",
    );
    expect(without.resolution?.agent).toBe("spectre");
  });
});

describe("resolve: the crosscheck", () => {
  test("the crosscheck takes a different family, never a different alias", () => {
    const found = resolve(
      "judgment",
      { effort: "high", crosscheck: { effort: "high" } },
      kept([
        allow("glm", "opencode-go/glm-5.3-flash"),
        // A second alias for the same model. Its alias differs and its family
        // does not, so it is not a second opinion.
        allow("glm-two", "opencode-go/glm-5.3-flash"),
        allow("deep", "opencode-go/deepseek-v4.1-flash"),
      ]),
      "spectre",
    );
    expect(found.resolution?.primary.alias).toBe("glm");
    expect(found.resolution?.crosscheck?.alias).toBe("deep");
    // The primary meets its requirement at the rung it used, so it did not
    // step up. The rung under that one is still named.
    expect(found.resolution?.primary.steppedUp).toBe(false);
    expect(found.resolution?.primary.below).toBe("low");
    // The report carries the same excluded list twice: what was spent, and
    // what was not.
    expect(found.resolution?.excluded).toEqual(found.excluded);
  });

  test("prefer free takes the zero-cost one that qualifies", () => {
    const found = resolve(
      "worker",
      { effort: "high", crosscheck: { effort: "high", prefer: "free" } },
      kept([
        allow("glm", "opencode-go/glm-5.3-flash"),
        allow("deep", "opencode-go/deepseek-v4.1-flash"),
        allow("free", "opencode-go/minimax-m3.1-flash-free"),
      ]),
      "spectre",
    );
    expect(found.resolution?.primary.alias).toBe("glm");
    expect(found.resolution?.crosscheck?.alias).toBe("free");
    expect(found.resolution?.crosscheck?.costInput).toBe(0);
  });

  test("prefer free is a preference, so a paid family serves when no free one reaches", () => {
    const found = resolve(
      "worker",
      { effort: "high", crosscheck: { effort: "high", prefer: "free" } },
      kept([
        allow("muse", "opencode-go/muse-spark-1.3-contributor"),
        allow("kimi", "opencode-go/kimi-k3"),
      ]),
      "spectre",
    );
    expect(found.resolution?.primary.alias).toBe("muse");
    expect(found.resolution?.crosscheck?.alias).toBe("kimi");
  });

  test("the crosscheck reads the whole allowlist, not the candidates after the primary", () => {
    const found = resolve(
      "thinking",
      { effort: "max", crosscheck: { effort: "low" } },
      kept([allow("low", "acme/falcon-low"), allow("glm", "opencode-go/glm-5.3-flash")]),
      "spectre",
    );
    expect(found.resolution?.primary.alias).toBe("glm");
    expect(found.resolution?.crosscheck?.alias).toBe("low");
    // The crosscheck is a model that was spent, so it is not reported as a
    // candidate that did not qualify.
    expect(found.excluded.map((one) => one.alias)).toEqual([]);
  });

  test("a crosscheck no other family can reach reports capacity", () => {
    const found = resolve(
      "judgment",
      { effort: "high", crosscheck: { effort: "max" } },
      kept([
        allow("glm", "opencode-go/glm-5.3-flash"),
        allow("glm-two", "opencode-go/glm-5.3-flash"),
        allow("muse", "opencode-go/muse-spark-1.3-contributor"),
      ]),
      "spectre",
    );
    expect(found.resolution?.primary.alias).toBe("glm");
    expect(found.resolution?.crosscheck).toBeUndefined();
    expect(found.excluded).toHaveLength(1);
    expect(found.excluded[0]?.alias).toBe("muse");
    expect(found.excluded[0]?.reason).toContain('cannot serve the crosscheck at "max"');
    expect(found.excluded[0]?.reaches).toBe("xhigh");
  });

  test("a crosscheck that no other family can serve says so", () => {
    // One family only, so no second opinion exists at any effort. The report
    // says that, because an absent crosscheck and a crosscheck that could
    // not be had must not read the same.
    const found = resolve(
      "judgment",
      { effort: "high", crosscheck: { effort: "high" } },
      kept([
        allow("glm", "opencode-go/glm-5.3-flash"),
        allow("glm-two", "opencode-go/glm-5.3-flash"),
      ]),
      "spectre",
    );
    expect(found.resolution?.primary.alias).toBe("glm");
    expect(found.resolution?.crosscheck).toBeUndefined();
    expect(found.resolution?.crosscheckProblem).toContain('the crosscheck at "high"');
  });

  test("a row with no family is not a second opinion", () => {
    // The catalogue states no family, so nothing shows that this model is a
    // different one. It is not reported short either, because no capacity of
    // its could have filled the role.
    const found = resolve(
      "worker",
      { effort: "high", crosscheck: { effort: "high" } },
      kept([
        allow("muse", "opencode-go/muse-spark-1.3-contributor"),
        allow("nofamily", "acme/falcon-nofamily"),
      ]),
      "spectre",
    );
    expect(found.resolution?.primary.alias).toBe("muse");
    expect(found.resolution?.crosscheck).toBeUndefined();
    expect(found.excluded).toEqual([]);
  });
});

describe("resolve: a requirement nothing reaches", () => {
  test("the problem names the effort, and the excluded list carries the capacity", () => {
    const found = resolve(
      "thinking",
      { effort: "max" },
      kept([
        allow("muse", "opencode-go/muse-spark-1.3-contributor"),
        allow("plain", "acme/falcon-plain"),
      ]),
      "spectre",
    );
    expect(found.resolution).toBeUndefined();
    expect(found.problem).toContain("profiles.thinking.effort");
    expect(found.problem).toContain('"max"');
    expect(found.problem).toContain("muse xhigh");
    expect(found.problem).toContain("plain no rung");
    expect(found.excluded.map((one) => one.alias)).toEqual(["muse", "plain"]);
  });

  test("an unknown name is met only by a rung of the same name", () => {
    const found = resolve(
      "worker",
      { effort: "turbo" },
      kept([
        allow("muse", "opencode-go/muse-spark-1.3-contributor"),
        allow("turbo", "acme/falcon-turbo"),
      ]),
      "spectre",
    );
    expect(found.problem).toBeUndefined();
    expect(found.resolution?.primary.alias).toBe("turbo");
    expect(found.resolution?.primary.rung).toBe("turbo");
    expect(found.resolution?.primary.steppedUp).toBe(false);
    expect(found.excluded[0]?.reason).toBe('cannot reach "turbo". Its highest rung is "xhigh"');

    // No model declares it, and a known rung above it is not a step up.
    const missing = resolve(
      "worker",
      { effort: "turbo" },
      kept([allow("muse", "opencode-go/muse-spark-1.3-contributor")]),
      "spectre",
    );
    expect(missing.resolution).toBeUndefined();
    expect(missing.problem).toContain('no allowed model declares "turbo"');
  });
});

describe("rungFor", () => {
  test("the allowlist's pinned variant is the only rung the model is asked for", () => {
    const candidate = kept([allow("light", "acme/falcon-mini#high")])[0];
    if (candidate === undefined) throw new Error("the allowlist kept nothing");

    // `high` meets `high`, and it is short of `max` even though the model
    // declares `none` below it and nothing above it.
    expect(rungFor(candidate, effortOf("high"))).toMatchObject({
      kind: "rung",
      at: { name: "high" },
    });
    expect(rungFor(candidate, effortOf("max"))).toMatchObject({
      kind: "short",
      best: { name: "high" },
    });
  });
});
