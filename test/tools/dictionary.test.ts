import { describe, expect, test } from "bun:test";
import {
  approves,
  buildIndex,
  deciding,
  type Entry,
  loadDictionary,
  lookup,
} from "../../tools/definitions/prose/dictionary";

/**
 * The dictionary is the reader's own copy, so this file never carries one. These
 * tests use three invented entries and assert the rulings the export shape implies.
 * A real export is checked by pointing the tool at one.
 */

const CHECK: Entry = {
  headword: "CHECK (n)",
  pos: "n",
  approved: true,
  meaning: "an inspection",
  page: "2-1-C2",
};
const SECURE: Entry = {
  headword: "secure (v)",
  pos: "v",
  approved: false,
  alternatives: [{ word: "ATTACH", pos: "v" }],
  page: "2-1-S7",
};
const CHECK_V: Entry = {
  headword: "check (v)",
  pos: "v",
  approved: false,
  alternatives: [{ word: "CHECK", pos: "n" }],
  page: "2-1-C6",
};
const USE_N: Entry = { headword: "use (n)", pos: "n", approved: false, page: "2-1-U8" };
const USE_V: Entry = { headword: "USE (v)", pos: "v", approved: true, page: "2-1-U8" };
const COME_ON: Entry = {
  headword: "COME ON (v)",
  pos: "v",
  approved: true,
  page: "2-1-C9",
};

const one = async (entries: ReadonlyArray<Entry>) => {
  const path = `/private/tmp/spectre-dict-${process.pid}-${entries.length}-${Math.floor(performance.now())}.json`;
  await Bun.write(
    path,
    JSON.stringify({
      meta: {
        source: "test",
        source_url: "https://example.invalid/",
        copyright: "test fixture",
        usage_note: "test",
        part: "Part 2",
        issue: "9 (2025-01-15)",
        pages: "fixture",
        entry_count: entries.length,
        approved_count: entries.filter((one) => one.approved).length,
        non_approved_count: entries.filter((one) => one.approved === false).length,
        schema: { entry: {} },
        note: "test fixture, not a dictionary",
      },
      entries,
    }),
  );
  const loaded = await loadDictionary(path);
  await Bun.$`rm -f ${path}`.quiet();
  return loaded;
};

describe("indexing", () => {
  test("a headword is found by itself, case folded, marker stripped", () => {
    // The export carries `CHECK (n)` as the headword, the way the dictionary
    // prints it, so a lookup for `check` is the normal case and not the edge one.
    const found = buildIndex([CHECK]);
    expect(found.get("check")).toHaveLength(1);
  });

  test("a lookup folds case, because the index is already folded", () => {
    // `Map.get` is case-sensitive and the key is lowercased once, at build time.
    // Folding again at lookup would be a second answer to the same question.
    const found = buildIndex([CHECK]);
    const loaded = { entries: found, issue: "", sourceUrl: "", copyright: "", count: 1 };
    expect(lookup(loaded, "CHECK")).toHaveLength(1);
    expect(lookup(loaded, "Check")).toHaveLength(1);
    expect(approves(loaded, "CHECK", "n").verdict).toBe("approved");
  });

  test("a multi-word headword is also found by each word in it", () => {
    const found = buildIndex([COME_ON]);
    expect(found.get("come on")).toHaveLength(1);
    expect(found.get("come")).toHaveLength(1);
  });

  test("an entry with no headword is skipped rather than indexed as empty", () => {
    const found = buildIndex([{ headword: "  " }, CHECK]);
    expect(found.size).toBeGreaterThan(0);
    expect(found.get("")).toBeUndefined();
  });
});

describe("a ruling", () => {
  test("an approved entry is approved", async () => {
    const loaded = await one([CHECK]);
    expect(loaded.count).toBe(1);
    expect(loaded.issue).toContain("9");
    expect(loaded.problem).toBeUndefined();
  });

  test("approved is decided by the flag, and a missing flag means approved", () => {
    const found = buildIndex([{ headword: "WORD" }]);
    expect(
      lookup({ entries: found, issue: "", sourceUrl: "", copyright: "", count: 1 }, "word")[0]
        ?.approved,
    ).toBe(true);
  });

  test("a word with no entry is unknown, not not-approved", async () => {
    const loaded = await one([CHECK]);
    // A word missing from the export may be a declared technical noun, and
    // reporting that as a violation would be wrong.
    expect(approves(loaded, "grommet").verdict).toBe("unknown");
  });

  test("a lowercase entry is not approved, and carries its alternatives", async () => {
    const loaded = await one([SECURE]);
    const got = approves(loaded, "secure");
    expect(got.verdict).toBe("not-approved");
    expect(got.applicable[0]?.alternatives).toEqual([{ word: "ATTACH", pos: "v" }]);
  });

  test("a part of speech the entry does not hold for is not approved", async () => {
    // CHECK is approved as a noun only, so `check the valve` is rule 1.2 broken.
    const loaded = await one([CHECK, CHECK_V]);
    // No part of speech asked for, and the dictionary splits it: CHECK (n) is
    // approved and check (v) is not. Reporting the approved one would be a lie by
    // omission, because `check` is a verb in 231 places in this set.
    expect(approves(loaded, "check").verdict).toBe("approved");
    expect(approves(loaded, "check").applicable.map((one) => `${one.pos}:${one.approved}`)).toEqual(
      ["n:true"],
    );
    expect(approves(loaded, "check", "n").verdict).toBe("approved");
    expect(approves(loaded, "check", "v").verdict).toBe("not-approved");
  });

  test("a word split by part of speech is approved and not approved at once", async () => {
    // The real export has CHECK (n) approved and check (v) not approved. Reporting
    // only "approved" would read as a clean bill for a verb this set uses 231 times.
    const loaded = await one([CHECK, CHECK_V]);
    const got = approves(loaded, "check");
    expect(got.verdict).toBe("approved");
    expect(got.applicable.map((one) => one.pos)).toEqual(["n"]);
    expect(got.all.filter((one) => !one.approved).map((one) => one.pos)).toEqual(["v"]);
  });

  test("the entry that decided is the approved one, not the first in the file", async () => {
    // The export lists the lowercase, not-approved noun after the uppercase verb for
    // USE, so reading the first entry found would invert the answer.
    const loaded = await one([USE_N, USE_V]);
    expect(deciding(approves(loaded, "use"))?.pos).toBe("v");
  });

  test("a word with nothing approved still reports its alternatives", async () => {
    // The bug this pins: reporting no alternatives answers "not approved" with no
    // way forward, which is the one case where the reader needs them most.
    const loaded = await one([SECURE]);
    const got = approves(loaded, "secure");
    expect(got.verdict).toBe("not-approved");
    expect(got.applicable).toHaveLength(1);
    expect(got.applicable[0]?.alternatives).toEqual([{ word: "ATTACH", pos: "v" }]);
  });

  test("an entry with no part of speech answers any part of speech", () => {
    const loaded = {
      entries: buildIndex([{ headword: "ANY" }]),
      issue: "",
      sourceUrl: "",
      copyright: "",
      count: 1,
    };
    expect(approves(loaded, "any", "n").verdict).toBe("approved");
    expect(approves(loaded, "any", "v").verdict).toBe("approved");
  });
});

describe("a bad file", () => {
  test("a missing file is a problem string, not a throw", async () => {
    const loaded = await loadDictionary("/private/tmp/spectre-no-such-dictionary.json");
    expect(loaded.problem).toContain("no such file");
    expect(loaded.count).toBe(0);
  });

  test("a file that is not JSON names itself as not JSON", async () => {
    const path = "/private/tmp/spectre-bad-dictionary.json";
    await Bun.write(path, "this is not json");
    const loaded = await loadDictionary(path);
    await Bun.$`rm -f ${path}`.quiet();
    expect(loaded.problem).toContain("not JSON");
  });

  test("JSON without an entries array is rejected rather than read as empty", async () => {
    // An empty dictionary and a file that is not one look identical otherwise,
    // and silently reporting every word unknown would be worse than failing.
    const path = "/private/tmp/spectre-empty-dictionary.json";
    await Bun.write(path, JSON.stringify({ meta: { issue: "9" } }));
    const loaded = await loadDictionary(path);
    await Bun.$`rm -f ${path}`.quiet();
    expect(loaded.problem).toContain("entries");
  });
});
