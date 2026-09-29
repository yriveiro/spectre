import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { load } from "../../tools/definitions/routing/load";
import { useScratch } from "./fixture";

const scratch = useScratch();
const run = (directory: string) => Effect.runPromise(load(directory));

describe("load", () => {
  test("no config anywhere is an empty table, not a failure", async () => {
    const found = await run(scratch.projectDir());
    expect(found.sources).toEqual([]);
    expect(found.problems).toEqual([]);
    expect(found.tables.models).toEqual({});
  });

  test("a valid file is read and its path is a source", async () => {
    await scratch.writeProject(
      JSON.stringify({
        models: { haiku: "anthropic/claude-haiku-4-5" },
        profiles: { explorer: { model: "haiku", why: "one named file" } },
      }),
    );
    const found = await run(scratch.projectDir());
    expect(found.problems).toEqual([]);
    expect(found.sources).toEqual([`${scratch.projectDir()}/spectre.jsonc`]);
    expect(found.tables.models).toEqual({ haiku: "anthropic/claude-haiku-4-5" });
    expect(found.tables.profiles.explorer).toEqual({
      model: ["haiku"],
      why: "one named file",
    });
  });

  test("$schema is accepted", async () => {
    await scratch.writeProject(
      JSON.stringify({ $schema: "https://opencode.ai/config.json", models: {} }),
    );
    expect((await run(scratch.projectDir())).problems).toEqual([]);
  });

  test("an unknown top-level key is rejected and named", async () => {
    await scratch.writeProject(JSON.stringify({ models: {}, arena: {} }));
    const found = await run(scratch.projectDir());
    expect(found.problems).toHaveLength(1);
    expect(found.problems[0]).toContain("arena");
    expect(found.sources).toEqual([]);
  });

  test("an unknown key inside a profile names the whole path", async () => {
    await scratch.writeProject(
      JSON.stringify({
        profiles: { p: { model: "haiku", why: "w", extra: 1 } },
      }),
    );
    const found = await run(scratch.projectDir());
    expect(found.problems[0]).toContain("profiles.p.extra");
  });

  test("a missing required field names the field", async () => {
    await scratch.writeProject(JSON.stringify({ profiles: { p: { model: "haiku" } } }));
    expect((await run(scratch.projectDir())).problems[0]).toContain("profiles.p.why");
  });

  test("a value of the wrong type names the value", async () => {
    await scratch.writeProject(JSON.stringify({ models: { haiku: 5 } }));
    expect((await run(scratch.projectDir())).problems[0]).toContain("models.haiku");
  });

  test("a broken document reports the file and not a position", async () => {
    await scratch.writeProject("{ this is not json");
    const found = await run(scratch.projectDir());
    expect(found.problems).toHaveLength(1);
    expect(found.problems[0]).toContain(`${scratch.projectDir()}/spectre.jsonc`);
  });

  test("both files are read, lowest precedence first", async () => {
    await scratch.writeGlobal(
      JSON.stringify({
        models: { haiku: "anthropic/claude-haiku-4-5", sonnet: "anthropic/other" },
      }),
    );
    await scratch.writeProject(JSON.stringify({ models: { opus: "opencode/gpt-5" } }));
    const found = await run(scratch.projectDir());
    expect(found.sources).toHaveLength(2);
    expect(found.sources[0]).toContain("global");
    expect(Object.keys(found.tables.models).sort()).toEqual(["haiku", "opus", "sonnet"]);
  });

  test("a later entry replaces the earlier one whole", async () => {
    await scratch.writeGlobal(
      JSON.stringify({ models: { haiku: "anthropic/claude-haiku-4-5#high" } }),
    );
    await scratch.writeProject(JSON.stringify({ models: { haiku: "opencode/gpt-5" } }));
    expect((await run(scratch.projectDir())).tables.models).toEqual({
      haiku: "opencode/gpt-5",
    });
  });

  test("null removes an inherited model, and a profile that needs it says so", async () => {
    await scratch.writeGlobal(
      JSON.stringify({
        models: { haiku: "anthropic/claude-haiku-4-5" },
        profiles: { explorer: { model: "haiku", why: "w" } },
      }),
    );
    await scratch.writeProject(JSON.stringify({ models: { haiku: null } }));
    const found = await run(scratch.projectDir());
    expect(found.tables.models).toEqual({});
    expect(found.problems).toEqual([]);
    expect(found.tables.profiles.explorer).toEqual({ model: ["haiku"], why: "w" });
  });

  test("null removes an inherited profile", async () => {
    await scratch.writeGlobal(
      JSON.stringify({ profiles: { explorer: { model: "haiku", why: "w" } } }),
    );
    await scratch.writeProject(JSON.stringify({ profiles: { explorer: null } }));
    expect((await run(scratch.projectDir())).tables.profiles).toEqual({});
  });

  test("a profile listing several models keeps them all, in order", async () => {
    await scratch.writeProject(
      JSON.stringify({
        models: { a: "anthropic/claude-haiku-4-5", b: "anthropic/claude-opus-4-1" },
        profiles: { refactor: { model: ["b", "a"], why: "w" } },
      }),
    );
    expect((await run(scratch.projectDir())).tables.profiles.refactor?.model).toEqual(["b", "a"]);
  });

  test("a broken project file still yields the global tables", async () => {
    await scratch.writeGlobal(JSON.stringify({ models: { haiku: "anthropic/claude-haiku-4-5" } }));
    await scratch.writeProject("{ broken");
    const found = await run(scratch.projectDir());
    expect(found.problems).toHaveLength(1);
    expect(found.sources).toHaveLength(1);
    expect(found.tables.models).toEqual({ haiku: "anthropic/claude-haiku-4-5" });
  });
});
