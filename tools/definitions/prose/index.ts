import { relative, resolve } from "node:path";
import { Effect, Schema } from "effect";
import { AbsolutePath } from "@opencode/schema/schema";
import { Tool } from "@opencode/schema/tool";
import { RULE_NAMES, lint } from "./rules";

const Input = Schema.Struct({
  targets: Schema.Array(Schema.String).annotate({
    description:
      "Files or directories holding prose, relative to the project directory or absolute. A directory is walked for .md and .mdx.",
  }),
  disable: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: `Rule names to skip. Known: ${RULE_NAMES.join(", ")}.`,
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

The lexical half of the standard is not here at all. It needs the ~900-word approved
dictionary, which Issue 9 does not let this project carry. What a rule here catches is
structure; which word is the approved one is a person reading it.

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

const inventory = async (
  directory: string,
  input: {
    readonly targets: ReadonlyArray<string>;
    readonly disable?: ReadonlyArray<string>;
    readonly limit?: number;
    readonly offset?: number;
  },
): Promise<Page> => {
  const offset = input.offset ?? 0;
  const limit = input.limit ?? DEFAULT_LIMIT;
  const disabled = new Set(input.disable ?? []);
  const unknown = [...disabled].filter((name) => !RULE_NAMES.includes(name));
  if (unknown.length > 0) throw new Error(`unknown rule: ${unknown.join(", ")}. known: ${RULE_NAMES.join(", ")}`);

  const found: Array<Page["findings"][number]> = [];
  const errors: Array<{ target: string; reason: string }> = [];
  const empty: Array<string> = [];
  let scanned = 0;

  for (const asked of input.targets) {
    const target = resolve(directory, asked);
    const before = found.length;

    let files: ReadonlyArray<string>;
    try {
      files = await filesIn(target);
    } catch (cause) {
      errors.push({
        target: asked,
        reason: cause instanceof Error ? cause.message : String(cause),
      });
      continue;
    }

    for (const file of files) {
      if (!PROSE.has(file.slice(file.lastIndexOf(".")).toLowerCase())) continue;
      const findings = lint(await Bun.file(file).text(), disabled);
      if (findings.length === 0) continue;
      scanned += 1;
      const name = relative(directory, file).split("\\").join("/");
      for (const one of findings) found.push({ ...one, file: name });
    }

    if (found.length === before) empty.push(asked);
  }

  const ordered = found.toSorted((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  const page = ordered.slice(offset, offset + limit);

  return {
    findings: page,
    errors,
    empty,
    hard: ordered.filter((one) => one.level === "hard").length,
    advisory: ordered.filter((one) => one.level === "advisory").length,
    total: ordered.length,
    scanned,
    truncated: offset + page.length < ordered.length,
  };
};

export const prose = (directory: AbsolutePath): Tool.Info<typeof Input, typeof Output> => ({
  name: "prose",
  description: DESCRIPTION,
  input: Input,
  output: Output,
  options: { namespace: "spectre", codemode: true, pinned: true, permission: "read" },
  execute: (input) => Effect.promise(async () => ({ output: await inventory(directory, input) })),
});