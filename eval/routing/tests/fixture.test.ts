import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { load } from "../../../tools/definitions/routing/load";
import { offences } from "../../bar";
import { blind, NONE, tuned } from "../fixture";

/**
 * The bar the blind slice is held to, read at the routing surface.
 *
 * A row that quotes the `match` line of the profile it names is a row that was
 * written against the surface, and the repository's rule is that such a row is
 * not evidence. The bar itself lives in `eval/bar.ts`, and this test names the
 * `match` lines as the descriptions, keyed by profile name.
 *
 * The config is read by the tool's own loader, so the test holds the rows to
 * the same file the runner prices and the tool routes on.
 */

const PROJECT = new URL("../../../", import.meta.url).pathname;

describe("the routing corpus", () => {
  test("no blind row quotes the match line of the profile it names", async () => {
    const found = await Effect.runPromise(load(PROJECT));
    const descriptions = new Map<string, string>(
      Object.entries(found.tables.profiles).map(([name, entry]) => [name, entry.match ?? ""]),
    );

    const offenders = offences(blind, descriptions).map(
      (one) => `${one.prompt} -> ${one.id} (${one.shared} words)`,
    );

    expect(offenders).toEqual([]);
  });

  test("every judged row names a profile the config carries, and a negative row names none", async () => {
    const found = await Effect.runPromise(load(PROJECT));
    const known = new Set(Object.keys(found.tables.profiles));

    const unknown = [...tuned, ...blind]
      .filter((row) => row.provenance === "judged" && !known.has(row.label))
      .map((row) => `${row.label} <- ${row.prompt}`);
    expect(unknown).toEqual([]);

    const named = [...tuned, ...blind]
      .filter((row) => row.provenance === "neg" && row.label !== NONE)
      .map((row) => row.label);
    expect(named).toEqual([]);
  });

  test("no prompt is in the corpus twice", () => {
    const seen = new Map<string, string>();
    const duplicates: Array<string> = [];

    for (const [slice, rows] of [
      ["tuned", tuned],
      ["blind", blind],
    ] as const)
      for (const row of rows) {
        const prompt = row.prompt.toLowerCase();
        const where = seen.get(prompt);
        if (where === undefined) seen.set(prompt, slice);
        else duplicates.push(`${prompt} in ${where} and ${slice}`);
      }

    expect(duplicates).toEqual([]);
  });
});
