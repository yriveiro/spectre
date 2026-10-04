/**
 * The lexical half of ASD-STE100, read from the reader's own copy of the
 * dictionary.
 *
 * The dictionary is not in this repository. Issue 9 restricts reproduction of it
 * to eight categories of organisation, and this project is in none of them, so
 * nothing here carries the word list. What this file reads is a JSON export the
 * reader produced from a PDF they hold, pointed at by `dictionary` in
 * `spectre.jsonc`. The export format is documented in `tools/FOR_AGENTS.md`.
 *
 * Every finding this module produces is advisory and never fails a run, for the
 * same reason `passive-voice` does not: a word the reader has not checked against
 * the real standard is a claim, not a fact.
 */

export type Ruling = {
  /** The headword as the dictionary prints it. */
  readonly headword: string;
  /** True when the dictionary prints the word in UPPERCASE, which is how it approves one. */
  readonly approved: boolean;
  /** Part of speech the ruling is for. Empty when the entry names none. */
  readonly pos: string;
  /** The meaning the dictionary gives, when the export carries one. */
  readonly meaning: string;
  /** Approved words the dictionary offers instead, when the entry is not approved. */
  readonly alternatives: ReadonlyArray<{ word: string; pos: string }>;
  /** The page label the entry came from, so a reader can check it in their own PDF. */
  readonly page: string;
};

/** One entry of the export, as the schema defines it. Only the fields used here are typed. */
export type Entry = {
  readonly headword: string;
  readonly pos?: string;
  readonly approved?: boolean;
  readonly meaning?: string;
  readonly page?: string;
  readonly alternatives?: ReadonlyArray<{ word?: string; pos?: string }>;
};

type Export_ = {
  readonly meta?: {
    readonly issue?: string;
    readonly part?: string;
    readonly source_url?: string;
    readonly copyright?: string;
    readonly entry_count?: number;
    readonly note?: string;
  };
  readonly entries?: ReadonlyArray<Entry>;
};

export type Verdict = {
  readonly verdict: "approved" | "not-approved" | "unknown";
  /** The entries that decided it. */
  readonly applicable: ReadonlyArray<Ruling>;
  /** Every entry for the word, whatever its part of speech. */
  readonly all: ReadonlyArray<Ruling>;
};

export type Loaded = {
  readonly entries: ReadonlyMap<string, ReadonlyArray<Ruling>>;
  readonly issue: string;
  readonly sourceUrl: string;
  readonly copyright: string;
  readonly count: number;
  /** Set when the file could not be read or does not have the documented shape. */
  readonly problem?: string;
};

/**
 * The lookup key for a headword.
 *
 * The export puts the part of speech in the headword, as `CHECK (n)`, because
 * that is how the dictionary prints it. A lookup for `check` has to find that
 * entry, so the marker is stripped before keying. A headword that carries no
 * marker is its own key.
 */
const key = (headword: string): string =>
  headword
    .trim()
    .replace(/\s*\((?:[a-z]{1,6}|TN|TA)\)\s*$/i, "")
    .toLowerCase();

/**
 * Index by headword and by each phrase inside a multi-word headword, so
 * `COME ON` is found by `come on` and a lookup for `come` still finds `COME`.
 * Both are the same entry, and the standard approves a verb phrase as one unit.
 */
export const buildIndex = (
  entries: ReadonlyArray<Entry>,
): ReadonlyMap<string, ReadonlyArray<Ruling>> => {
  const out = new Map<string, Array<Ruling>>();

  for (const entry of entries) {
    const headword = entry.headword?.trim();
    if (headword === undefined || headword.length === 0) continue;

    const ruling: Ruling = {
      headword,
      approved: entry.approved !== false,
      pos: entry.pos ?? "",
      meaning: entry.meaning ?? "",
      alternatives: (entry.alternatives ?? [])
        .filter((one) => (one.word ?? "").trim().length > 0)
        .map((one) => ({ word: (one.word ?? "").trim(), pos: one.pos ?? "" })),
      page: entry.page ?? "",
    };

    for (const name of new Set([headword, ...headword.split(/\s+/)].map(key))) {
      if (name.length === 0) continue;
      const bucket = out.get(name) ?? [];
      bucket.push(ruling);
      out.set(name, bucket);
    }
  }

  return out;
};

/** Read a dictionary export. A bad file is a problem string, never a throw. */
export const loadDictionary = async (path: string): Promise<Loaded> => {
  const none: Loaded = {
    entries: new Map(),
    issue: "",
    sourceUrl: "",
    copyright: "",
    count: 0,
  };

  const file = Bun.file(path);
  if (!(await file.exists().catch(() => false)))
    return { ...none, problem: `${path}: no such file` };

  let parsed: unknown;
  try {
    parsed = await file.json();
  } catch (cause) {
    return {
      ...none,
      problem: `${path}: not JSON (${cause instanceof Error ? cause.message : String(cause)})`,
    };
  }

  const doc = parsed as Export_;
  if (!Array.isArray(doc.entries))
    return {
      ...none,
      problem: `${path}: no "entries" array, so this is not a dictionary export`,
    };

  return {
    entries: buildIndex(doc.entries),
    issue: doc.meta?.issue ?? "",
    sourceUrl: doc.meta?.source_url ?? "",
    copyright: doc.meta?.copyright ?? "",
    count: doc.entries.length,
  };
};

/** Every ruling for one word, most specific first. Empty when the dictionary has no entry. */
export const lookup = (loaded: Loaded, word: string): ReadonlyArray<Ruling> =>
  loaded.entries.get(key(word)) ?? [];

/**
 * Whether a word is approved for the part of speech it is being used as.
 *
 * An entry with no part of speech is a ruling for the word itself, so it answers
 * any part of speech. A word with no entry is unknown rather than not approved:
 * a word missing from the export may be a technical noun the reader declared,
 * and reporting that as a violation would be wrong.
 */
export const approves = (loaded: Loaded, word: string, pos?: string): Verdict => {
  const all = lookup(loaded, word);
  if (all.length === 0) return { verdict: "unknown", applicable: all, all };

  const wanted = pos?.trim().toLowerCase() ?? "";

  // A part of speech was asked for, so the entries for it decide the verdict and
  // the others are reported beside it. `check` without a part of speech is
  // genuinely two answers: CHECK (n) is approved and check (v) is not, and
  // reporting the first one found would answer a question nobody asked.
  const matched =
    wanted === "" ? all : all.filter((one) => one.pos === "" || one.pos.toLowerCase() === wanted);
  if (matched.length === 0) return { verdict: "not-approved", applicable: [], all };

  // No part of speech asked for, so only the approved entries decide it. When
  // nothing is approved, every entry is reported instead: those are the ones
  // carrying the alternatives, and reporting none would answer "not approved"
  // with no way forward.
  const approved = matched.filter((one) => one.approved);
  const applicable = wanted === "" && approved.length > 0 ? approved : matched;

  return {
    verdict: approved.length > 0 ? "approved" : "not-approved",
    applicable,
    all,
  };
};

/**
 * The entry a reader would open in their own PDF: the first one that decided the
 * verdict, and a not-approved entry when the word has nothing approved at all.
 */
export const deciding = (asked: Verdict): Ruling | undefined => {
  const approved = asked.applicable.find((one) => one.approved);
  if (approved !== undefined) return approved;
  return asked.applicable[0] ?? asked.all[0];
};
