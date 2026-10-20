import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { load } from "../../skills/definitions";
import { offences, permitted } from "../bar";
import { blind, heldOut, tuned } from "../fixture";

/**
 * The bar the blind slice is held to. A row that quotes the description of the
 * leaf it names is not a held-out row: the leaf wins it by carrying the words,
 * not by routing the moment. Four rows of the legacy held-out slice drifted
 * inside a description that way, which is why the number it reads is no longer
 * the honest one.
 *
 * The bar itself lives in `eval/bar.ts`, because the writer of a fresh batch
 * runs the same check before a row can land in the corpus.
 */


describe("the blind slice", () => {
  test("no row quotes the description of the leaf it names", async () => {
    const definitions = await Effect.runPromise(load());
    const descriptions = new Map<string, string>(
      definitions.map((one) => [one.id as string, one.description ?? ""]),
    );

    const offenders = offences(blind, descriptions).map(
      (offence) => `${offence.prompt} -> ${offence.id} (${offence.shared} words)`,
    );

    expect(offenders).toEqual([]);
  });

  test("every row names a skill this plugin registers", async () => {
    const definitions = await Effect.runPromise(load());
    const known = new Set<string>(definitions.map((one) => one.id as string));

    const offenders = blind
      .flatMap((row) => permitted(row.label))
      .filter((id) => id !== "none" && !known.has(id));

    expect(offenders).toEqual([]);
  });

  test("every principle has a row somewhere in the corpus", async () => {
    const definitions = await Effect.runPromise(load());
    const principles = definitions.map((one) => one.id).filter((id) => id.startsWith("principle-"));
    const covered = new Set([...tuned, ...heldOut, ...blind].flatMap((row) => permitted(row.label)));

    const uncovered = principles.filter((id) => !covered.has(id));

    expect(uncovered).toEqual([]);
  });

  test("no prompt is in the corpus twice", () => {
    const seen = new Map<string, string>();
    const duplicates: Array<string> = [];

    for (const [slice, rows] of [
      ["tuned", tuned],
      ["heldOut", heldOut],
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
