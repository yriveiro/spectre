import { beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";

/**
 * `AGENTS.md` approves exactly two `node:*` imports, and every one of them is a deliberate
 * exception with a reason beside it. The table drifts when nobody re-derives it, and it had:
 * the row said seventeen files and named seventeen, but two of the named files did not import
 * `node:path` and two that did were not named. The count stayed right by coincidence while the
 * list was wrong in both directions, so a reader auditing a new `node:path` import could not
 * tell from the table whether it was already approved.
 *
 * Both sides are read independently here: the filesystem says what the code imports, the table
 * says what the document claims. The comparison fails when either moves alone.
 */

const ROOT = join(import.meta.dir, "..");
const APPROVED = ["node:path", "node:fs/promises"] as const;

/**
 * The source tree, which is what the table describes. `test/` is not source, because a test
 * importing `node:path` to build a fixture path is not an exception anyone has to approve.
 *
 * The top level is read off disk rather than written down, so a new source folder is walked
 * without editing this file. `node_modules` is pruned rather than filtered after the walk,
 * because scanning it costs seconds and nothing in it is ours.
 */
const SKIP = new Set(["node_modules", "test", "dist"]);

const sourceFiles = async () => {
  // `onlyFiles: false` is on `scan`, not on the constructor, and without it the glob returns
  // files only, so the walk finds `index.ts` at the root and no folder to descend into.
  const top = new Bun.Glob("*").scan({ cwd: ROOT, dot: false, onlyFiles: false });
  const folders: Array<string> = [];
  const found: Array<string> = [];
  for await (const name of top) {
    if (SKIP.has(name)) continue;
    const at = join(ROOT, name);
    if ((await Bun.file(at).stat()).isDirectory()) folders.push(name);
    else if (name.endsWith(".ts")) found.push(name);
  }

  const ts = new Bun.Glob("**/*.ts");
  for (const folder of folders)
    for await (const entry of ts.scan({ cwd: join(ROOT, folder), dot: false }))
      found.push(`${folder}/${entry}`);

  return found.toSorted();
};

/** What the code imports, keyed by specifier. The other half of the comparison. */
const byModule = new Map<string, Array<string>>();

beforeAll(async () => {
  for (const file of await sourceFiles()) {
    const text = await Bun.file(join(ROOT, file)).text();
    for (const match of text.matchAll(/from\s+"(node:[a-z_/]+)"/g)) {
      const specifier = match[1]!;
      const files = byModule.get(specifier) ?? [];
      files.push(file);
      byModule.set(specifier, files.toSorted());
    }
  }
});

const importers = (specifier: string) => byModule.get(specifier) ?? [];

/**
 * The paths one row names. A brace group stands for several files, so `a/{b,c}.ts` expands to
 * the two it means.
 */
const namedPaths = (row: string) => {
  const expanded = new Set<string>();
  for (const match of row.matchAll(/`([A-Za-z0-9_./{},-]+\.ts)`/g)) {
    // `/` is inside the braces on purpose: `worktrees/{read,classify,return/standing}.ts` names
    // three files and the third one has a separator in it. A class without `/` matches nothing,
    // the group falls through, and the row appears to list 14 files when it lists 17.
    const group = /^([\w./-]*)\{([\w.,/-]+)\}([\w./-]*)$/.exec(match[1]!);
    if (group === null) expanded.add(match[1]!);
    else for (const part of group[2]!.split(",")) expanded.add(`${group[1]}${part}${group[3]}`);
  }
  return [...expanded].toSorted();
};

/** The number a row claims, spelled the way the table spells it. */
const SPELLED: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  "twenty-one": 21,
  "twenty-two": 22,
};

const WORDS = Object.keys(SPELLED).join("|");

const SECTION = "### Approved `node:*` exceptions";

/**
 * The approved row, not the first row with that cell.
 *
 * `AGENTS.md` carries two tables whose first column is a `node:*` import: the "reach for this
 * instead" table, which names the Bun API to use, and the approved-exceptions table, which
 * names the files. Both rows start with `| \`node:path\` |`, so a plain `find` returns the
 * replacement row, which lists nothing, and every assertion below passes against it.
 *
 * Anchored on the heading rather than on the prose, so renaming the section fails loudly here
 * instead of silently matching the wrong table.
 */
const rowFor = async (specifier: string) => {
  const text = await Bun.file(join(ROOT, "AGENTS.md")).text();
  const at = text.indexOf(SECTION);
  if (at < 0) throw new Error(`AGENTS.md has no "${SECTION}" section`);
  const row = text
    .slice(at)
    .split("\n")
    .find((line) => line.startsWith(`| \`${specifier}\` |`));
  if (row === undefined) throw new Error(`AGENTS.md approves no row for ${specifier}`);
  return row;
};

const claimedCount = (row: string) => {
  const found = new RegExp(`\\b(${WORDS})\\s+files?\\b`, "i").exec(row);
  return found === null ? undefined : SPELLED[found[1]!.toLowerCase()];
};

describe("every node:* import is an approved exception", () => {
  test("no source file imports a module AGENTS.md did not approve", () => {
    const unapproved = [...byModule.keys()].filter((one) => !APPROVED.includes(one as never));
    // Names, not a count, so the failure says which import needs a row and a reason.
    expect(unapproved.toSorted()).toEqual([]);
  });
});

describe("the AGENTS.md rows name the files that actually import them", () => {
  for (const specifier of APPROVED) {
    test(`${specifier} row lists every source file that imports it`, async () => {
      const actual = importers(specifier);
      const named = namedPaths(await rowFor(specifier));
      // Both directions. An importer the row omits is an exception nobody approved, and a file
      // the row names that no longer imports it is a reason describing the wrong code.
      expect(actual.filter((one) => !named.includes(one))).toEqual([]);
      expect(named.filter((one) => !actual.includes(one))).toEqual([]);
    });

    test(`${specifier} row counts the files it lists`, async () => {
      const actual = importers(specifier);
      const named = namedPaths(await rowFor(specifier));
      const claimed = claimedCount(await rowFor(specifier));
      // The word and the list are two claims. The list was right and the word drifted, so both
      // are read here rather than trusting the list to imply the count.
      expect({ claimed, listed: named.length, importing: actual.length }).toEqual({
        claimed: actual.length,
        listed: actual.length,
        importing: actual.length,
      });
    });
  }
});
