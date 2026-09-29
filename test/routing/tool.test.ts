import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { routing, type Page } from "../../tools/definitions/routing";
import { context, useScratch } from "./fixture";

/**
 * The tool, not the pipeline: what a model actually receives. Two things matter
 * here and nowhere else — a bad config is an answer rather than a failed call,
 * and the table is withheld when any check fails, so a half-valid table cannot
 * be routed on.
 *
 * The sandbox boundary cannot be proven from here. Per `tools/FOR_AGENTS.md` a
 * registration which logs is not a tool that runs; only a real call in a live
 * session proves that.
 */
const scratch = useScratch();

const call = async (
  directory: string,
  input: { profile?: string } = {},
  list?: () => Effect.Effect<unknown, unknown>,
) => {
  const run = routing(context(directory, list)).execute as unknown as (given: {
    profile?: string;
  }) => Effect.Effect<{ output: Page }>;
  return (await Effect.runPromise(run(input))).output;
};

const good = JSON.stringify({
  models: { haiku: "anthropic/claude-haiku-4-5" },
  profiles: { explorer: { model: "haiku", why: "one named file" } },
});

describe("tools.spectre.routing", () => {
  test("a good config returns the table and no problems", async () => {
    await scratch.writeProject(good);
    const out = await call(scratch.projectDir());
    expect(out.problems).toBeUndefined();
    expect(out.profiles).toEqual([
      {
        name: "explorer",
        models: [{ name: "haiku", model: "anthropic/claude-haiku-4-5" }],
        agent: "spectre",
        why: "one named file",
      },
    ]);
    expect(out.models).toEqual([{ name: "haiku", model: "anthropic/claude-haiku-4-5" }]);
    expect(out.sources).toHaveLength(1);
  });

  test("a profile with several candidates returns all of them, in order", async () => {
    await scratch.writeProject(
      JSON.stringify({
        models: {
          haiku: "anthropic/claude-haiku-4-5",
          opus: "anthropic/claude-opus-4-1",
        },
        profiles: { refactor: { model: ["opus", "haiku"], why: "w" } },
      }),
    );
    const out = await call(scratch.projectDir());
    expect(out.profiles[0]?.models.map((one) => one.model)).toEqual([
      "anthropic/claude-opus-4-1",
      "anthropic/claude-haiku-4-5",
    ]);
  });

  test("a ref the catalogue does not have comes back as problems, not a crash", async () => {
    await scratch.writeProject(
      JSON.stringify({ models: { ghost: "anthropic/claude-imaginary-9" } }),
    );
    const out = await call(scratch.projectDir());
    expect(out.profiles).toEqual([]);
    expect(out.models).toEqual([]);
    expect(out.problems).toContain("models.ghost");
  });

  test("problems from reading and from checking arrive together, one per line", async () => {
    await scratch.writeProject("{ broken");
    await scratch.writeGlobal(
      JSON.stringify({ models: { ghost: "anthropic/claude-imaginary-9" } }),
    );
    const out = await call(scratch.projectDir());
    const lines = (out.problems ?? "").split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain(`${scratch.projectDir()}/spectre.jsonc`);
    expect(lines[1]).toContain("models.ghost");
  });

  test("a config with no models at all is a problem, not a silent empty table", async () => {
    await scratch.writeProject(JSON.stringify({ models: {} }));
    const out = await call(scratch.projectDir());
    expect(out.problems).toContain("no models are allowed");
  });

  test("no config at all is an empty table with no problems", async () => {
    const out = await call(scratch.projectDir());
    expect(out.problems).toBeUndefined();
    expect(out.profiles).toEqual([]);
    expect(out.sources).toEqual([]);
  });

  test("naming one profile returns that row", async () => {
    await scratch.writeProject(
      JSON.stringify({
        models: {
          haiku: "anthropic/claude-haiku-4-5",
          opus: "anthropic/claude-opus-4-1",
        },
        profiles: {
          explorer: { model: "haiku", why: "w" },
          reviewer: { model: "opus", why: "w" },
        },
      }),
    );
    const out = await call(scratch.projectDir(), { profile: "reviewer" });
    expect(out.profiles.map((one) => one.name)).toEqual(["reviewer"]);
  });

  test("naming a profile that does not exist narrows to nothing, without an error", async () => {
    await scratch.writeProject(good);
    const out = await call(scratch.projectDir(), { profile: "nope" });
    expect(out.problems).toBeUndefined();
    expect(out.profiles).toEqual([]);
  });

  test("a catalogue that cannot be read is reported, and no model is claimed checked", async () => {
    await scratch.writeProject(good);
    const out = await call(scratch.projectDir(), {}, () => Effect.fail("boom"));
    expect(out.problems).toContain("catalogue could not be read");
    expect(out.models).toEqual([]);
  });
});
