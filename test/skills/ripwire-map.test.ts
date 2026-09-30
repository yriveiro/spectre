import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { load, notALeaf } from "../../skills/definitions/index";

/**
 * `skills/FOR_AGENTS.md` requires the map in `ripwire/SKILL.md` to carry a row
 * per leaf, and the count of rows answering `none` to match what
 * `spectre-mode/SKILL.md` claims about it. Both drifted once while the set grew,
 * and neither is visible from a leaf, so they are checked here.
 */

const DIR = "skills/definitions";
const MAP = `${DIR}/ripwire/SKILL.md`;
const HUB = `${DIR}/spectre-mode/SKILL.md`;

const rows = async () => {
  const text = await Bun.file(MAP).text();
  // A markdown row ends in a trailing pipe, so the answer cell is followed by
  // `|`, not by end of line. Reading it as end of line matches nothing.
  return [...text.matchAll(/^\| `([a-z-]+)` \|[^|]*\| ([^|]*?)\s*\|$/gm)].map((m) => ({
    leaf: m[1]!,
    answer: m[2]!.trim(),
  }));
};

describe("every principle has a row in the map", () => {
  test("no leaf is missing, and a row names no leaf that does not exist", async () => {
    const skills: ReadonlyArray<string> = (await Effect.runPromise(load())).map((one) => one.id);
    const listed = new Set((await rows()).map((one) => one.leaf));

    const missing = skills.filter((id) => !listed.has(id) && !notALeaf.has(id));
    const stale = [...listed].filter((id) => !skills.includes(id));

    expect({ missing, stale }).toEqual({ missing: [], stale: [] });
  });

  test("every id in notALeaf names a skill that exists", async () => {
    const skills = new Set<string>((await Effect.runPromise(load())).map((one) => one.id));
    const unknown = [...notALeaf].filter((id) => !skills.has(id));

    expect(unknown).toEqual([]);
  });
});

const WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
  "twenty",
] as const;

describe("the none count agrees with the hub", () => {
  test("spectre-mode states the number of rows answering none", async () => {
    const none = (await rows()).filter((one) => one.answer.startsWith("none.")).length;
    const hub = await Bun.file(HUB).text();
    // The claim wraps across a line break in the hub, so the pattern spans one.
    // It is spelled as a word, because the sentence around it is prose.
    const claim = hub.match(/names the (\w+) leaves with no\s+instrument/);

    expect(claim).not.toBeNull();
    const said = WORDS.indexOf(claim![1] as (typeof WORDS)[number]);
    expect(said === -1 ? `the hub says "${claim![1]}", which is not a number` : none).toBe(said);
  });
});
