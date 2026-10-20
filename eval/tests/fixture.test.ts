import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { load } from "../../skills/definitions";
import { blind, heldOut, tuned } from "../fixture";

/**
 * The bar the blind slice is held to. A row that quotes the description of the
 * leaf it names is not a held-out row: the leaf wins it by carrying the words,
 * not by routing the moment. Four rows of the legacy held-out slice drifted
 * inside a description that way, which is why the number it reads is no longer
 * the honest one.
 */
const MAX_SHARED_RUN = 3;

const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 0);

/** The longest run of consecutive words two texts share. */
const longestRun = (a: ReadonlyArray<string>, b: ReadonlyArray<string>) => {
  let longest = 0;
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < b.length; j++) {
      let run = 0;
      while (i + run < a.length && j + run < b.length && a[i + run] === b[j + run]) run++;
      if (run > longest) longest = run;
    }
  return longest;
};

const permitted = (label: string) => (label === "none" ? ["none"] : label.split(",").map((one) => one.trim()));

describe("the blind slice", () => {
  test("no row quotes the description of the leaf it names", async () => {
    const definitions = await Effect.runPromise(load());
    const descriptions = new Map<string, string>(
      definitions.map((one) => [one.id as string, one.description ?? ""]),
    );

    const offenders = blind
      .filter((row) => row.label !== "none")
      .flatMap((row) => {
        const prompt = words(row.prompt);
        return permitted(row.label).flatMap((id) => {
          const description = words(descriptions.get(id) ?? "");
          const shared = longestRun(prompt, description);
          return shared > MAX_SHARED_RUN ? [`${row.prompt} -> ${id} (${shared} words)`] : [];
        });
      });

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
