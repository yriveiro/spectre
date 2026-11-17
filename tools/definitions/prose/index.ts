import { relative, resolve } from "node:path";
import type { Tool } from "@opencode/plugin/effect";
import type { AbsolutePath } from "@opencode/schema/schema";
import { Effect, Schema } from "effect";
import { approves, deciding, type Loaded, loadDictionary, lookup } from "./dictionary";
import { lint, RULE_NAMES } from "./rules";

const Input = Schema.Struct({
  targets: Schema.optional(Schema.Array(Schema.String)).annotate({
    description:
      "Files or directories holding prose, relative to the project directory or absolute. A directory is walked for .md and .mdx. Omit to ask about words only, which is what a caller does when it has no dictionary and wants the structural rules on nothing.",
  }),
  disable: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: `Rule names to skip. Known: ${RULE_NAMES.join(", ")}.`,
  }),
  words: Schema.optional(Schema.Array(Schema.String)).annotate({
    description:
      "Words to rule on against the dictionary, lowercased or not. Returns the approved or not-approved verdict and the part of speech it holds for. Omit to skip the lexical half.",
  }),
  dictionary: Schema.optional(Schema.String).annotate({
    description:
      "A dictionary export to use instead of the one spectre.json names. Omit to use the configured path, which is the normal case.",
  }),
  limit: Schema.optional(Schema.Number).annotate({
    description: "Maximum findings to return. Default 400.",
  }),
  offset: Schema.optional(Schema.Number).annotate({
    description: "Findings to skip before the returned page starts. Default 0.",
  }),
});

const Output = Schema.Struct({
  findings: Schema.Array(
    Schema.Struct({
      file: Schema.String,
      line: Schema.Number,
      rule: Schema.String,
      level: Schema.Literals(["hard", "advisory"]),
      text: Schema.String,
      why: Schema.String,
    }),
  ),
  errors: Schema.Array(Schema.Struct({ target: Schema.String, reason: Schema.String })),
  empty: Schema.Array(Schema.String),
  hard: Schema.Number,
  advisory: Schema.Number,
  total: Schema.Number,
  scanned: Schema.Number,
  truncated: Schema.Boolean,
  rulings: Schema.Array(
    Schema.Struct({
      word: Schema.String,
      verdict: Schema.Literals(["approved", "not-approved", "unknown"]),
      pos: Schema.optional(Schema.String),
      headword: Schema.String,
      approvedFor: Schema.Array(Schema.String),
      alternatives: Schema.Array(Schema.Struct({ word: Schema.String, pos: Schema.String })),
      meaning: Schema.String,
      page: Schema.String,
      /** Parts of speech this word is NOT approved for, when it splits by part of speech. */
      alsoNotApprovedFor: Schema.Array(Schema.String),
    }),
  ),
  dictionary: Schema.optional(
    Schema.Struct({
      path: Schema.String,
      issue: Schema.String,
      entries: Schema.Number,
      problem: Schema.optional(Schema.String),
    }),
  ),
});

type Page = typeof Output.Type;

const DEFAULT_LIMIT = 400;

const DESCRIPTION = `Check Markdown prose against ASD-STE100 Simplified Technical English grammar rules and approved-word dictionaries.
Reports hard violations (semicolons, phrasal verbs, nominalizations, marketing adjectives, sentences over 25 words) and advisory findings (passive voice, present perfect) across .md and .mdx files, plus optional lexical word rulings against a configured STE dictionary JSON export.`;

const PROSE = new Set([".md", ".mdx", ".markdown"]);

const filesIn = async (target: string): Promise<ReadonlyArray<string>> => {
  const stat = await Bun.file(target)
    .stat()
    .catch(() => undefined);
  if (stat === undefined) throw new Error("no such file or directory");
  if (stat.isFile()) return [target];

  const found: Array<string> = [];
  const glob = new Bun.Glob("**/*.{md,mdx,markdown}");

  for await (const entry of glob.scan({ cwd: target, absolute: true, dot: false })) {
    if (entry.split("/").some((part) => part === "node_modules" || part === ".git")) continue;
    found.push(entry);
  }

  return found.toSorted();
};

type Scan = {
  findings: Array<Page["findings"][number]>;
  errors: Array<{ target: string; reason: string }>;
  empty: Array<string>;
  scanned: number;
};

const reason = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

/** One target, one answer. A target that cannot be read is an error row, never a throw. */
const scanTarget = async (
  asked: string,
  directory: string,
  disabled: ReadonlySet<string>,
): Promise<Scan> => {
  const none: Scan = { findings: [], errors: [], empty: [], scanned: 0 };
  const target = resolve(directory, asked);

  let files: ReadonlyArray<string>;
  try {
    files = await filesIn(target);
  } catch (cause) {
    return { ...none, errors: [{ target: asked, reason: reason(cause) }] };
  }

  const findings: Array<Page["findings"][number]> = [];
  let scanned = 0;

  for (const file of files) {
    if (!PROSE.has(file.slice(file.lastIndexOf(".")).toLowerCase())) continue;
    const found = lint(await Bun.file(file).text(), disabled);
    if (found.length === 0) continue;
    scanned += 1;
    const name = relative(directory, file).split("\\").join("/");
    for (const one of found) findings.push({ ...one, file: name });
  }

  return { findings, errors: [], empty: findings.length === 0 ? [asked] : [], scanned };
};

/** One word, one row. The verdict plus the entry a reader would check in their own PDF. */
const rule = (loaded: Loaded, word: string): Page["rulings"][number] => {
  const asked = word.trim();
  const got = approves(loaded, asked);
  // The entry that decided the verdict, not the first one in the file: `check`
  // has two, and the noun is approved while the verb is not.
  const decided = deciding(got);
  const known = decided === undefined ? lookup(loaded, asked) : got.all;

  return {
    word: asked,
    verdict: got.verdict,
    pos: decided?.pos === "" || decided === undefined ? undefined : decided.pos,
    headword: decided?.headword ?? "",
    approvedFor: got.applicable.filter((one) => one.approved).map((one) => one.pos || "any"),
    // The alternatives belong to the entries that were ruled on, not to every
    // sense the word happens to have.
    alternatives: got.applicable.flatMap((one) => one.alternatives),
    meaning: decided?.meaning ?? "",
    page: decided?.page ?? "",
    // One word, more than one verdict, when the dictionary splits it by part of
    // speech and the caller did not say which. A reader needs to see both.
    alsoNotApprovedFor: known.filter((one) => !one.approved).map((one) => one.pos || "any"),
  };
};

/** Words, or nothing. The structural half does not need a dictionary. */
const rulings = async (
  words: ReadonlyArray<string> | undefined,
  path: string | undefined,
): Promise<{
  rulings: Array<Page["rulings"][number]>;
  dictionary?: Page["dictionary"];
}> => {
  if (words === undefined || path === undefined) return { rulings: [] };

  const loaded = await loadDictionary(path);
  return {
    rulings: words.map((one) => rule(loaded, one)),
    dictionary: {
      path,
      issue: loaded.issue,
      entries: loaded.count,
      problem: loaded.problem,
    },
  };
};

const inventory = async (
  directory: string,
  input: {
    readonly targets?: ReadonlyArray<string>;
    readonly disable?: ReadonlyArray<string>;
    readonly words?: ReadonlyArray<string>;
    readonly dictionary?: string;
    readonly limit?: number;
    readonly offset?: number;
  },
  configured: string | undefined,
): Promise<Page> => {
  const offset = input.offset ?? 0;
  const limit = input.limit ?? DEFAULT_LIMIT;
  const disabled = new Set(input.disable ?? []);
  const unknown = [...disabled].filter((name) => !RULE_NAMES.includes(name));
  if (unknown.length > 0)
    throw new Error(`unknown rule: ${unknown.join(", ")}. known: ${RULE_NAMES.join(", ")}`);

  const found: Array<Page["findings"][number]> = [];
  const errors: Array<{ target: string; reason: string }> = [];
  const empty: Array<string> = [];
  let scanned = 0;

  const scans = await Promise.all(
    (input.targets ?? []).map((asked) => scanTarget(asked, directory, disabled)),
  );

  for (const one of scans) {
    found.push(...one.findings);
    errors.push(...one.errors);
    empty.push(...one.empty);
    scanned += one.scanned;
  }

  const ordered = found.toSorted((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  const page = ordered.slice(offset, offset + limit);

  const said = await rulings(input.words, input.dictionary ?? configured);

  return {
    findings: page,
    errors,
    empty,
    hard: ordered.filter((one) => one.level === "hard").length,
    advisory: ordered.filter((one) => one.level === "advisory").length,
    total: ordered.length,
    scanned,
    truncated: offset + page.length < ordered.length,
    rulings: said.rulings,
    dictionary: said.dictionary,
  };
};

/**
 * `dictionary` is the path from `spectre.json`, passed in by the caller so this
 * file reads no config. A missing key means the lexical half is off, which is not
 * an error: the structural rules do not need it.
 */
export const prose = (
  directory: AbsolutePath,
  dictionary?: string,
): Tool.Info<typeof Input, typeof Output> => ({
  name: "prose",
  description: DESCRIPTION,
  input: Input,
  output: Output,
  options: { namespace: "spectre", codemode: true, permission: "read" },
  execute: (input) =>
    Effect.promise(async () => ({ output: await inventory(directory, input, dictionary) })),
});
