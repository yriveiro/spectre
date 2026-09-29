import { relative, resolve } from "node:path";
import { Effect, Schema } from "effect";
import { AbsolutePath } from "@opencode/schema/schema";
import { Tool } from "@opencode/schema/tool";

const SKIP = new Set(["node_modules", ".git", "dist", "build", "coverage", ".next", ".turbo"]);

const C_STYLE = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
const HASH_STYLE = new Set([".py", ".sh", ".rb", ".yml", ".yaml", ".toml"]);

const SUPPRESSION =
  /eslint-disable|prettier-ignore|biome-ignore|@ts-(ignore|expect-error|nocheck)|noqa|ruff\s*:|pylint\s*:|rubocop:|shellcheck\s+disable|nolint/;

const DEFAULT_LIMIT = 400;

const Input = Schema.Struct({
  targets: Schema.Array(Schema.String).annotate({
    description:
      "Files or directories to inventory, relative to the project directory or absolute.",
  }),
  limit: Schema.optional(Schema.Number).annotate({
    description: `Maximum hits to return. Default ${DEFAULT_LIMIT}.`,
  }),
  offset: Schema.optional(Schema.Number).annotate({
    description: "Hits to skip before the returned page starts. Default 0.",
  }),
});

const Output = Schema.Struct({
  hits: Schema.Array(
    Schema.Struct({
      file: Schema.String,
      line: Schema.Number,
      kind: Schema.Literals(["comment", "doc", "suppression"]),
      text: Schema.String,
    }),
  ),
  errors: Schema.Array(Schema.Struct({ target: Schema.String, reason: Schema.String })),
  empty: Schema.Array(Schema.String),
  total: Schema.Number,
  suppressions: Schema.Number,
  scanned: Schema.Number,
  truncated: Schema.Boolean,
});

type Page = typeof Output.Type;
type Kind = Page["hits"][number]["kind"];

const DESCRIPTION = `Inventory every comment and every lint or type suppression under the given targets — never a judgment.

It cannot apply a keep list, so every hit it returns still goes through one.

Targets are files or directories, relative to the project directory or absolute. It
returns a flat page of hits plus the totals for the whole scope, so a caller can
narrow before it reads anything:

  { hits: [{ file, line, kind, text }], errors, empty, total, suppressions, scanned, truncated }

- \`file\` is relative to the project directory. \`text\` is the whole line, trimmed, so a
  comment that trails code arrives with the code it annotates.
- \`kind\` is \`comment\`, \`doc\`, or \`suppression\`. A suppression is a comment with a
  rule attached: eslint-disable, prettier-ignore, biome-ignore, @ts-ignore,
  @ts-expect-error, @ts-nocheck, noqa, ruff:, pylint:, rubocop:, shellcheck disable,
  nolint.
- \`total\` and \`suppressions\` count the whole scope. \`hits\` is only the page named by
  \`offset\` and \`limit\`, and \`truncated\` is true when the page is not the whole scope.
- \`errors\` lists the targets that could not be scanned, and \`empty\` the targets that
  produced no hits. An empty result and a failed scan look identical otherwise. A
  bad target never fails the call: every hit that did scan is still returned.

The scan is lexical, not a parse, so a file mid-edit still reads. It reads whole
strings before it looks for a marker, so a comment marker inside a string is not a
comment, and a comment trailing code on its line is reported at that line.

Four limits remain, all lexical. A \`#\` must start its line or follow whitespace, so
\`x = 1#note\` is missed where Python and Ruby would read one. A YAML block scalar
whose lines start with \`#\` is reported. A Ruby \`=begin\` block is not read. A template
holding a nested template inside \`\${ }\` ends at the first backtick, so a comment
after it can be missed. None are worth a parse dependency: the caller judges every
hit anyway, so a false positive costs one dismissal and a false negative costs a
grep.`;

type RawHit = { readonly line: number; readonly kind: Kind; readonly text: string };

const C_TOKEN =
  /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`|\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|(?<![\w$)\]}`"']\s*)\/(?![/*])(?:[^/\\\n[]|\\.|\[(?:[^\]\\\n]|\\.)*\])+\/[a-z]*/g;

const HASH_TOKEN =
  /"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|(?<=^|[^\S])#[^\n]*/g;

const classify = (part: string, doc: boolean): Kind => {
  if (SUPPRESSION.test(part)) return "suppression";
  if (doc || part.startsWith("/**") || part.startsWith("///") || part.trimStart().startsWith("*"))
    return "doc";
  return "comment";
};

const isComment = (body: string) =>
  body.startsWith("//") || body.startsWith("/*") || body.startsWith("#");

const scanFile = (text: string, ext: string): ReadonlyArray<RawHit> => {
  const style = HASH_STYLE.has(ext) ? "hash" : C_STYLE.has(ext) ? "c" : undefined;
  if (style === undefined) return [];

  const lines = text.split("\n");
  const hits: Array<RawHit> = [];
  let cursor = 0;
  let line = 1;
  let last = 0;

  const newlines = (from: number, to: number) => {
    let count = 0;
    for (let at = from; at < to; at += 1) if (text[at] === "\n") count += 1;
    return count;
  };

  for (const token of text.matchAll(style === "c" ? C_TOKEN : HASH_TOKEN)) {
    const start = token.index;
    const body = token[0];
    const at = line + newlines(cursor, start);
    cursor = start + body.length;

    if (isComment(body) && !(start === 0 && body.startsWith("#!"))) {
      const doc = body.startsWith("/**");
      const parts = body.startsWith("/*") ? body.split("\n") : [body];
      for (const [offset, part] of parts.entries()) {
        const target = at + offset;
        const content = (lines[target - 1] ?? "").trim();
        if (target <= last || content.length === 0) continue;
        last = target;
        hits.push({ line: target, kind: classify(part, doc), text: content });
      }
    }

    line = at + newlines(start, cursor);
  }

  return hits;
};

const filesIn = async (target: string): Promise<ReadonlyArray<string>> => {
  const stat = await Bun.file(target)
    .stat()
    .catch(() => undefined);
  if (stat === undefined) throw new Error("no such file or directory");
  if (stat.isFile()) return [target];

  const glob = new Bun.Glob("**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs,py,sh,rb,yml,yaml,toml}");
  const found: Array<string> = [];

  for await (const entry of glob.scan({ cwd: target, absolute: true, dot: false })) {
    if (entry.split("/").some((part) => SKIP.has(part))) continue;
    found.push(entry);
  }

  return found.toSorted();
};

const inventory = async (
  directory: string,
  input: {
    readonly targets: ReadonlyArray<string>;
    readonly limit?: number;
    readonly offset?: number;
  },
): Promise<Page> => {
  const offset = input.offset ?? 0;
  const limit = input.limit ?? DEFAULT_LIMIT;
  const found: Array<Page["hits"][number]> = [];
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
      const hits = scanFile(await Bun.file(file).text(), file.slice(file.lastIndexOf(".")));
      if (hits.length === 0) continue;
      scanned += 1;
      const name = relative(directory, file).split("\\").join("/");
      for (const hit of hits) found.push({ ...hit, file: name });
    }

    if (found.length === before) empty.push(asked);
  }

  const hits = found.slice(offset, offset + limit);
  return {
    hits,
    errors,
    empty,
    total: found.length,
    suppressions: found.filter((hit) => hit.kind === "suppression").length,
    scanned,
    truncated: offset + hits.length < found.length,
  };
};

export const comments = (directory: AbsolutePath): Tool.Info<typeof Input, typeof Output> => ({
  name: "comments",
  description: DESCRIPTION,
  input: Input,
  output: Output,
  options: { namespace: "spectre", codemode: true, pinned: true, permission: "read" },
  execute: (input) => Effect.promise(async () => ({ output: await inventory(directory, input) })),
});
