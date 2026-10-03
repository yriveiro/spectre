import { relative, resolve } from "node:path";
import type { AbsolutePath } from "@opencode/schema/schema";
import type { Tool } from "@opencode/schema/tool";
import { Effect, Schema } from "effect";
import { approves, type Loaded, loadDictionary, lookup, type Ruling } from "./dictionary";
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
      "A dictionary export to use instead of the one spectre.jsonc names. Omit to use the configured path, which is the normal case.",
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

const DESCRIPTION = `Inventory the ASD-STE100 structural violations in prose files — never a judgment.

It returns a page of findings plus the totals for the whole scope, so a caller can
narrow before it reads anything:

  { findings: [{ file, line, rule, level, text, why }], errors, empty, hard, advisory, total, scanned, truncated }

- \`file\` is relative to the project directory.
- \`level\` is \`hard\` or \`advisory\`. A hard finding is a rule the standard states as
  mechanical: a semicolon (8.1), a phrasal verb (9.3), a nominalization (3.7), a
  marketing adjective, a sentence over 25 words (6.3). An advisory finding is
  reported and never fails anything: passive voice (3.6) and the present perfect
  (3.2), because both can carry a claim the rule would otherwise strip.
- \`hard\`, \`advisory\` and \`total\` count the whole scope. \`findings\` is only the page
  named by \`offset\` and \`limit\`.
- \`errors\` lists the targets that could not be read, and \`empty\` the ones with no
  findings. An empty result and a failed scan look identical otherwise.
- \`disable\` silences named rules, which is how a body that quotes the banned words
  stops reporting them.

What it will never report, on purpose:

- **Hedges and modality.** \`may\`, \`might\` and \`could\` are the author's stated
  confidence, so a checker that pressured them out would rewrite claims into facts.
- **Em dashes.** STE 8.1 bans the semicolon and permits every other standard mark.
- **Noun clusters.** Capping a stack at three words needs part-of-speech tagging, and
  a regex false-positives on every hyphenated compound.
- **Dropped articles.** Noticing a missing article needs semantics.

**With no \`dictionary\` in \`spectre.jsonc\`, only the structural half runs.** The six
rules above need no word list, so they work unchanged. A call that passes \`words\` with no
dictionary configured returns an empty \`rulings\` and no \`dictionary\` block rather than a
verdict, because the question was not answerable and saying so is the honest answer. Both
\`targets\` and \`words\` are optional, so a caller can ask about words alone and read
nothing.

The lexical half is off unless \`spectre.jsonc\` names a \`dictionary\`.
Pass \`words\` to rule on them: \`words: ["check", "secure", "grommet"]\` returns approved /
not-approved / unknown, the part of speech each ruling holds for, the alternatives the
dictionary offers, and the page label so you can check it in your own PDF. A word with no
entry comes back \`unknown\`, never \`not-approved\`: a missing word may be a technical noun
you declared, and the standard hands those to the project.

The dictionary is a path, not a word list. Issue 9 restricts reproduction of it to eight
categories of organisation, so no file in this repository carries one. Point \`dictionary\`
at a JSON export of your own copy and nothing is reproduced here.

Two things a lookup will not do. It does not read the export's \`senses[].non_ste\` examples
into a rule, so a word can be approved and still be wrong in context. And a
\`not-approved\` verdict on a software-engineering word is usually correct and usually not
actionable: this set is built on a technical glossary, and STE rule 1.5 hands that to the
project rather than forbidding it.

Four limits are lexical. A file mid-edit still reads. A semicolon inside a fenced block,
a table row, a heading or a blockquote is not prose, so it is skipped, which means a
prose sample placed in one of those containers is invisible. Sentence splitting reads a
dot inside an abbreviation or a filename as a full stop only when the next word starts
with a capital, so a sentence that continues in lower case after \`e.g.\` merges with its
neighbour. Inline code spans wrap across lines and are tracked as one span, so a span
opened and closed several lines apart is dropped whole. None needs a parser: the caller
judges every finding anyway, so a false positive costs one dismissal.`;

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
  const exact = lookup(loaded, asked);

  return {
    word: asked,
    verdict: got.verdict,
    pos: got.rulings[0]?.pos === "" ? undefined : got.rulings[0]?.pos,
    headword: exact[0]?.headword ?? "",
    approvedFor: got.rulings.filter((one) => one.approved).map((one: Ruling) => one.pos || "any"),
    alternatives: got.rulings.flatMap((one) => one.alternatives),
    meaning: got.rulings[0]?.meaning ?? "",
    page: got.rulings[0]?.page ?? "",
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
 * `dictionary` is the path from `spectre.jsonc`, passed in by the caller so this
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
  options: { namespace: "spectre", codemode: true, pinned: true, permission: "read" },
  execute: (input) =>
    Effect.promise(async () => ({ output: await inventory(directory, input, dictionary) })),
});
