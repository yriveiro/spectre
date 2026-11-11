import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  type PreferencePage,
  routingModelPreference,
} from "../../tools/definitions/routing/preference";
import { context, useScratch } from "./fixture";

const scratch = useScratch();

const call = async (
  directory: string,
  list?: () => Effect.Effect<unknown, unknown>,
  session?: { readonly id: string; readonly sessions: Record<string, string> },
): Promise<PreferencePage> => {
  const sessions = session?.sessions ?? { ses_project: directory };
  const run = routingModelPreference(context(directory, list, sessions)).execute as unknown as (
    given: Record<string, never>,
    context: { readonly sessionID: string },
  ) => Effect.Effect<{ readonly output: PreferencePage }>;
  return (await Effect.runPromise(run({}, { sessionID: session?.id ?? "ses_project" }))).output;
};

const at = <S extends PreferencePage["status"]>(
  out: PreferencePage,
  status: S,
): Extract<PreferencePage, { status: S }> => {
  expect(out.status).toBe(status);
  return out as Extract<PreferencePage, { status: S }>;
};

describe("routing_model_preference", () => {
  test("returns the allowlist in priority order, with the catalogue facts", async () => {
    await scratch.writeProject(
      JSON.stringify({
        models: { first: "acme/falcon-mini", second: "acme/falcon-max" },
        priority: ["second", "first"],
      }),
    );

    const out = at(await call(scratch.projectDir()), "resolved");
    expect(out.models.map((one) => [one.alias, one.priority])).toEqual([
      ["second", 1],
      ["first", 2],
    ]);
    expect(out.crosscheck.map((one) => [one.alias, one.priority])).toEqual([
      ["second", 1],
      ["first", 2],
    ]);
    expect(out.models[0]?.ref).toBe("acme/falcon-max");
    expect(out.sources).toEqual([`${scratch.projectDir()}/spectre.json`]);
  });

  test("returns the crosscheck fallback order as its own list", async () => {
    await scratch.writeProject(
      JSON.stringify({
        models: { first: "acme/falcon-mini", second: "acme/falcon-max" },
        priority: ["second", "first"],
        crosscheck: ["first"],
      }),
    );

    const out = at(await call(scratch.projectDir()), "resolved");
    expect(out.models.map((one) => one.alias)).toEqual(["second", "first"]);
    expect(out.crosscheck.map((one) => [one.alias, one.priority])).toEqual([["first", 1]]);
  });

  test("a file with no priority is a problem, so an implicit order never reads as a decision", async () => {
    await scratch.writeProject(JSON.stringify({ models: { first: "acme/falcon-mini" } }));
    const out = at(await call(scratch.projectDir()), "problems");
    expect(out.problems).toContain("priority: states no priority order");
  });

  test("a model the catalogue cannot see is a problem that names its alias", async () => {
    await scratch.writeProject(
      JSON.stringify({
        models: { ghost: "acme/falcon-ghost" },
        priority: ["ghost"],
      }),
    );
    const out = at(await call(scratch.projectDir()), "problems");
    expect(out.problems).toContain("models.ghost");
  });

  test("a session that cannot be read is a problem, not the plugin's directory", async () => {
    await scratch.writeProject(
      JSON.stringify({ models: { first: "acme/falcon-mini" }, priority: ["first"] }),
    );
    const out = at(
      await call(scratch.projectDir(), undefined, { id: "ses_missing", sessions: {} }),
      "problems",
    );
    expect(out.problems).toContain("ses_missing");
    expect(out.problems).toContain("could not be read");
  });
});
