import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Effect } from "effect";
import { type Page, routing } from "../../tools/definitions/routing";
import { context, useScratch } from "./fixture";

/**
 * The tool, not the pipeline: what a model actually receives.
 *
 * The output is a union, so a test names the status it expects and reads only
 * the fields that status carries. Five things matter here and nowhere else: a
 * bad config is an answer rather than a failed call, the table is withheld when
 * any check fails, the setup question is answered once, the ref that came back
 * is the ref a session spends, and the judge is optional.
 *
 * The sandbox boundary cannot be proven from here. Per `tools/FOR_AGENTS.md` a
 * registration which logs is not a tool that runs; only a real call in a live
 * session proves that.
 */
const scratch = useScratch();

/** A catalogue row as the tool reads it. Thin, because the normalizer is total. */
type Thin = {
  readonly providerID: string;
  readonly id: string;
  readonly family?: string;
  readonly variants: ReadonlyArray<{ readonly id: string }>;
};

const listOf = (models: ReadonlyArray<Thin>) => () =>
  Effect.succeed({ location: {}, data: models });

const call = async (
  directory: string,
  input: { profile?: string; task?: string; setup?: "accepted" | "declined" } = {},
  list?: () => Effect.Effect<unknown, unknown>,
) => {
  const run = routing(context(directory, list)).execute as unknown as (
    given: typeof input,
  ) => Effect.Effect<{
    output: Page;
  }>;
  return (await Effect.runPromise(run(input))).output;
};

/** The answer, once the test states which status it expects. */
const at = <S extends Page["status"]>(out: Page, status: S): Extract<Page, { status: S }> => {
  expect(out.status).toBe(status);
  return out as Extract<Page, { status: S }>;
};

/** One model that clears a requirement, one that stops under it. */
const LADDERS: ReadonlyArray<Thin> = [
  { providerID: "acme", id: "falcon-mini", variants: [{ id: "none" }, { id: "high" }] },
  { providerID: "acme", id: "falcon-low", variants: [{ id: "none" }] },
];

/** Two families, so a second opinion has somewhere to come from. */
const FAMILIES: ReadonlyArray<Thin> = [
  { providerID: "acme", id: "falcon-mini", family: "falcon", variants: [{ id: "high" }] },
  { providerID: "acme", id: "falcon-max", family: "raptor", variants: [{ id: "high" }] },
];

const good = JSON.stringify({
  models: { light: "acme/falcon-mini" },
  profiles: { explorer: { effort: "high", match: "one named file", why: "w" } },
});

/**
 * Two profiles one word apart, and the judge the config asks for. The lexical
 * arm needs no settings, so it is the arm a test can exercise without a network.
 */
const withJudge = (judge: Record<string, string>): string =>
  JSON.stringify({
    models: { light: "acme/falcon-mini" },
    profiles: {
      explorer: { effort: "high", match: "Use when one named file has to be read" },
      designer: { effort: "high", match: "Use when a design decision spans several files" },
    },
    judge,
  });

const judged = withJudge({ kind: "lexical" });

/** The task that names the words of the first profile and none of the second. */
const EXPLORE = "read one named file and say what it holds";

describe("tools.spectre.routing", () => {
  test("a good config resolves a profile and names the ref to spend", async () => {
    await scratch.writeProject(good);
    const out = at(await call(scratch.projectDir()), "resolved");

    expect(out.profiles).toHaveLength(1);
    expect(out.profiles[0]).toMatchObject({
      name: "explorer",
      match: "one named file",
      effort: "high",
      agent: "spectre",
      model: {
        ref: "acme/falcon-mini#high",
        rung: "high",
        pinned: false,
        steppedUp: false,
        below: "none",
        rungs: ["none", "high"],
        cost: { input: 0, output: 0 },
      },
      excluded: [],
    });
    expect(out.models).toEqual([{ name: "light", model: "acme/falcon-mini" }]);
    expect(out.sources).toEqual([`${scratch.projectDir()}/spectre.json`]);
    expect(out.asked).toEqual([]);
  });

  test("the first qualifying candidate is spent, and a candidate under the bar reports its capacity", async () => {
    await scratch.writeProject(
      JSON.stringify({
        models: { light: "acme/falcon-mini", tiny: "acme/falcon-low" },
        profiles: { work: { effort: "high", match: "w" } },
      }),
    );
    const out = at(await call(scratch.projectDir(), {}, listOf(LADDERS)), "resolved");

    expect(out.profiles[0]?.model.ref).toBe("acme/falcon-mini#high");
    expect(out.profiles[0]?.excluded).toEqual([
      {
        name: "tiny",
        ref: "acme/falcon-low",
        reason: 'cannot reach "high". Its highest rung is "none"',
        rungs: ["none"],
        reaches: "none",
      },
    ]);
  });

  test("a model with no thinking control is excluded, not silently dropped", async () => {
    await scratch.writeProject(
      JSON.stringify({
        models: { light: "acme/falcon-mini", plain: "opencode/gpt-5" },
        profiles: { work: { effort: "high", match: "w" } },
      }),
    );
    const out = at(await call(scratch.projectDir()), "resolved");

    expect(out.profiles[0]?.excluded).toEqual([
      {
        name: "plain",
        ref: "opencode/gpt-5",
        reason: 'has no thinking control, so it cannot reach "high"',
        rungs: [],
        reaches: undefined,
      },
    ]);
  });

  test("a pin skips the requirement and keeps the variant in the ref", async () => {
    await scratch.writeProject(
      JSON.stringify({
        models: { light: "acme/falcon-mini#high" },
        profiles: { pinned: { model: "light", match: "w" } },
      }),
    );
    const out = at(await call(scratch.projectDir()), "resolved");

    expect(out.profiles[0]?.model).toMatchObject({
      ref: "acme/falcon-mini#high",
      rung: "high",
      pinned: true,
      steppedUp: false,
    });
  });

  test("a crosscheck from another family is returned beside the primary", async () => {
    await scratch.writeProject(
      JSON.stringify({
        models: { light: "acme/falcon-mini", other: "acme/falcon-max" },
        profiles: { judged: { effort: "high", crosscheck: { effort: "high" }, match: "w" } },
      }),
    );
    const out = at(await call(scratch.projectDir(), {}, listOf(FAMILIES)), "resolved");

    expect(out.profiles[0]?.model.ref).toBe("acme/falcon-mini#high");
    expect(out.profiles[0]?.crosscheck?.ref).toBe("acme/falcon-max#high");
  });

  test("a crosscheck keeps a variant the allowlist pinned, without a second suffix", async () => {
    await scratch.writeProject(
      JSON.stringify({
        models: { light: "acme/falcon-mini", other: "acme/falcon-max#high" },
        profiles: { judged: { effort: "high", crosscheck: { effort: "high" }, match: "w" } },
      }),
    );
    const out = at(await call(scratch.projectDir(), {}, listOf(FAMILIES)), "resolved");

    expect(out.profiles[0]?.crosscheck?.ref).toBe("acme/falcon-max#high");
    expect(out.profiles[0]?.crosscheck?.rung).toBe("high");
  });

  test("a declared crosscheck that finds no other family says so", async () => {
    await scratch.writeProject(
      JSON.stringify({
        models: { light: "acme/falcon-mini", other: "acme/falcon-max" },
        profiles: { judged: { effort: "high", crosscheck: { effort: "high" }, match: "w" } },
      }),
    );
    const same = FAMILIES.map((one) => ({ ...one, family: "falcon" }));
    const out = at(await call(scratch.projectDir(), {}, listOf(same)), "resolved");

    expect(out.profiles[0]?.crosscheck).toBeUndefined();
    expect(out.profiles[0]?.crosscheckProblem).toContain(
      "found no allowed model from another family",
    );
  });

  test("a ref the catalogue does not have is a problem that names its key", async () => {
    await scratch.writeProject(JSON.stringify({ models: { ghost: "acme/falcon-ghost" } }));
    const out = at(await call(scratch.projectDir()), "problems");

    expect(out.problems).toContain("models.ghost");
  });

  test("problems from reading and from checking arrive together, one per line", async () => {
    await scratch.writeProject("{ broken");
    await scratch.writeGlobal(JSON.stringify({ models: { ghost: "acme/falcon-ghost" } }));
    const out = at(await call(scratch.projectDir()), "problems");
    const lines = out.problems.split("\n");

    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain(`${scratch.projectDir()}/spectre.json`);
    expect(lines[1]).toContain("models.ghost");
  });

  test("a config with no models at all is a problem, not a silent empty table", async () => {
    await scratch.writeProject(JSON.stringify({ models: {} }));
    const out = at(await call(scratch.projectDir()), "problems");

    expect(out.problems).toContain("models is empty");
  });

  test("no config at all asks for setup and puts the starter set on the table", async () => {
    const out = at(await call(scratch.projectDir()), "setup");

    expect(out.provider).toBe("opencode-go");
    expect(out.profiles.map((one) => one.name)).toEqual([
      "mechanical",
      "reading",
      "judgement",
      "deep",
    ]);
    expect(out.models.length).toBeGreaterThan(0);
    expect(out.source).toBe(`${scratch.projectDir()}/spectre.json`);
    expect(await Bun.file(out.source).exists()).toBe(false);
  });

  test("declining is written down, and the next call does not ask again", async () => {
    expect(at(await call(scratch.projectDir()), "setup").status).toBe("setup");

    const declined = at(await call(scratch.projectDir(), { setup: "declined" }), "declined");
    expect(declined.source).toBe(`${scratch.projectDir()}/spectre.json`);
    expect(await Bun.file(declined.source).json()).toEqual({ setup: "declined" });

    const again = at(await call(scratch.projectDir()), "declined");
    expect(again.source).toBe(declined.source);
  });

  test("a lone global decline answers, and a project config overrides it", async () => {
    await scratch.writeGlobal(JSON.stringify({ setup: "declined" }));
    const declined = at(await call(scratch.projectDir()), "declined");
    expect(declined.source).toBe(`${scratch.globalDir()}/spectre.json`);

    await scratch.writeProject(good);
    const out = at(await call(scratch.projectDir()), "resolved");
    expect(out.sources).toHaveLength(2);
  });

  test("accepting writes the starter set and resolves it", async () => {
    const starter = (await Bun.file(
      join(import.meta.dir, "../../spectre.default.json"),
    ).json()) as {
      models: Record<string, string>;
    };
    const catalogue = Object.values(starter.models).map((ref) => {
      const cut = ref.indexOf("/");
      return {
        providerID: ref.slice(0, cut),
        id: ref.slice(cut + 1),
        family: ref.slice(cut + 1),
        variants: ["low", "medium", "high", "max"].map((id) => ({ id })),
      };
    });

    const out = at(
      await call(scratch.projectDir(), { setup: "accepted" }, listOf(catalogue)),
      "resolved",
    );

    expect(out.sources).toEqual([`${scratch.projectDir()}/spectre.json`]);
    expect(out.models.map((one) => one.name)).toEqual(["minimax", "muse", "kimi"]);
    expect(out.profiles.map((one) => one.name)).toEqual([
      "mechanical",
      "reading",
      "judgement",
      "deep",
    ]);
    expect(out.profiles[0]?.model.ref.startsWith("opencode-go/")).toBe(true);
    expect(await Bun.file(`${scratch.projectDir()}/spectre.json`).exists()).toBe(true);
  });

  test("the setup answer is refused when routing is already configured", async () => {
    await scratch.writeProject(good);
    const out = at(await call(scratch.projectDir(), { setup: "declined" }), "problems");

    expect(out.problems).toContain("already configured");
    expect(await Bun.file(`${scratch.projectDir()}/spectre.json`).json()).toEqual(JSON.parse(good));
  });

  test("naming one profile returns that row, and says it was asked for", async () => {
    await scratch.writeProject(
      JSON.stringify({
        models: { light: "acme/falcon-mini" },
        profiles: {
          explorer: { effort: "high", match: "w" },
          reviewer: { effort: "high", match: "w" },
        },
      }),
    );
    const out = at(await call(scratch.projectDir(), { profile: "reviewer" }), "resolved");

    expect(out.profiles.map((one) => one.name)).toEqual(["reviewer"]);
    expect(out.asked).toEqual(["reviewer"]);
  });

  test("naming a profile that does not exist narrows to nothing, without an error", async () => {
    await scratch.writeProject(good);
    const out = at(await call(scratch.projectDir(), { profile: "nope" }), "resolved");

    expect(out.profiles).toEqual([]);
    expect(out.asked).toEqual(["nope"]);
  });

  test("a catalogue that cannot be read is reported, and no model is claimed checked", async () => {
    await scratch.writeProject(good);
    const out = at(await call(scratch.projectDir(), {}, () => Effect.fail("boom")), "problems");

    expect(out.problems).toContain("catalogue could not be read");
  });

  test("a judge that answers names the profile, and the row still carries the resolved model", async () => {
    await scratch.writeProject(judged);
    const out = at(await call(scratch.projectDir(), { task: EXPLORE }), "resolved");

    expect(out.judge).toMatchObject({ status: "used", profile: "explorer" });
    // The judge names no model, so the ref is the one a call with no judge
    // returns.
    expect(out.profiles[0]?.model.ref).toBe("acme/falcon-mini#high");
    expect(out.profiles.map((one) => one.name)).toEqual(["explorer", "designer"]);
    // A lexical score is not a probability, so the field is absent, not zero.
    if (out.judge.status === "used") expect(out.judge.confidence).toBeUndefined();
  });

  test("the judge's answer carries no model", async () => {
    await scratch.writeProject(judged);
    const out = at(await call(scratch.projectDir(), { task: EXPLORE }), "resolved");

    // The design rule: the judge picks a profile and the resolver picks the
    // model. A later arm cannot add a model here without this test failing.
    expect(Object.keys(out.judge).sort()).toEqual([
      "alternatives",
      "confidence",
      "profile",
      "status",
    ]);
  });

  test("a judge that cannot answer is skipped, and the reason is the arm's own", async () => {
    await scratch.writeProject(withJudge({ kind: "jev" }));
    const out = at(await call(scratch.projectDir(), { task: EXPLORE }), "resolved");

    expect(out.judge.status).toBe("skipped");
    // The System One arm with no endpoint never touches the network.
    if (out.judge.status === "skipped") expect(out.judge.reason).toContain("names no endpoint");
    expect(out.profiles).toHaveLength(2);
  });

  test("a config with no judge says so, and the whole table still comes back", async () => {
    await scratch.writeProject(good);
    const out = at(await call(scratch.projectDir(), { task: "read one named file" }), "resolved");

    expect(out.judge.status).toBe("skipped");
    if (out.judge.status === "skipped") expect(out.judge.reason).toContain("names no judge");
    expect(out.profiles.map((one) => one.name)).toEqual(["explorer"]);
  });

  test("a call with no task does not ask the judge", async () => {
    await scratch.writeProject(judged);
    const out = at(await call(scratch.projectDir()), "resolved");

    expect(out.judge.status).toBe("skipped");
    if (out.judge.status === "skipped") expect(out.judge.reason).toContain("names no task");
  });

  test("a named profile is the choice, so the judge is not asked", async () => {
    await scratch.writeProject(judged);
    const out = at(
      await call(scratch.projectDir(), { profile: "designer", task: EXPLORE }),
      "resolved",
    );

    expect(out.judge.status).toBe("skipped");
    if (out.judge.status === "skipped") expect(out.judge.reason).toContain("names a profile");
    expect(out.profiles.map((one) => one.name)).toEqual(["designer"]);
  });
});
