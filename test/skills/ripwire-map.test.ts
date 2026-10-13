import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { load, notALeaf } from "../../skills/definitions/index";

/**
 * `skills/FOR_AGENTS.md` requires the map in `ripwire/SKILL.md` to carry a row
 * per leaf, and the count of rows answering `none` to match what
 * `spectre-mode/SKILL.md` claims about it. Both drifted once while the set grew,
 * and neither is visible from a leaf, so they are checked here. The same goes
 * for every flag the map names and for the counts its closing sentence asserts.
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

const body = async () => await Bun.file(MAP).text();

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

/**
 * `WORDS` is ordered so that a word's position IS the number it spells, which is
 * what lets the hub's lookup read as an index. A tens word breaks that, so it is
 * spelled out here rather than appended to a list whose order carries meaning.
 */
const TENS = new Map<string, number>([
  ["twenty", 20],
  ["thirty", 30],
]);

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

/**
 * `ripwire --help` is the list of flags the binary answers to, and the map is a
 * list of flags to run. `--readability` drifted here exactly this way: it kept
 * working as a hidden alias while leaving the help, so a reader checking the
 * help concluded the flag was gone. Nothing in the set was watching.
 */
describe("every flag the map names is a flag ripwire has", () => {
  const RIPWIRE = Bun.which("ripwire");

  // `ripwire <dir> --flag` is the shape of a flag, not one.
  const SHAPE = new Set(["flag"]);

  test.skipIf(!RIPWIRE)("no name has drifted out of the installed ripwire", async () => {
    const help = Bun.spawnSync([RIPWIRE!, "--help"]).stdout.toString();
    const named = new Set<string>();

    for (const line of (await body()).split("\n")) {
      // A deprecated alias is named on purpose, to say that it is deprecated,
      // and a deprecated alias may be gone from the help and still answer.
      if (line.includes("deprecat")) continue;
      for (const [, flag] of line.matchAll(/--([a-z][a-z0-9-]{2,})/g)) {
        if (!SHAPE.has(flag!)) named.add(flag!);
      }
    }

    expect([...named].filter((flag) => !help.includes(`--${flag}`)).sort()).toEqual([]);
  });
});

describe("the closing sentence counts the table", () => {
  test("rows, none and verb rows agree with the rows the file holds", async () => {
    const all = await rows();
    const none = all.filter((one) => one.answer.startsWith("none.")).length;
    // Spelled as words, and wrapped, because the claim is prose around them.
    const claim = (await body()).match(
      /The map has ([\w-]+) rows\.\s+([\w-]+) of\s+them answer `none`, and ([\w-]+) name a verb/,
    );

    expect(claim).not.toBeNull();
    // A count over twenty is spelled as tens and ones, and the sentence that
    // holds it starts with a capital, so neither survives a bare lookup.
    const said = (at: number) => {
      const words = claim![at]!.toLowerCase().split("-");
      const parts = words.map((w) => TENS.get(w) ?? WORDS.indexOf(w as (typeof WORDS)[number]));
      if (parts.some((n) => n === -1)) return `"${claim![at]}" is not a number`;
      return parts.reduce((total, n) => total + n!, 0);
    };

    expect({ rows: said(1), none: said(2), verbs: said(3) }).toEqual({
      rows: all.length,
      none,
      verbs: all.length - none,
    });
  });
});
