import { relative, resolve } from "node:path";
import { Effect, Schema } from "effect";
import { AbsolutePath } from "@opencode/schema/schema";
import { Tool } from "@opencode/schema/tool";

const SKIP = new Set(["node_modules", ".git", "dist", "build", "coverage", ".next", ".turbo"]);

const C_STYLE = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
const HASH_STYLE = new Set([".py", ".sh", ".rb", ".yml", ".yaml", ".toml"]);

const SUPPRESSION =
  /eslint-disable|prettier-ignore|biome-ignore|@ts-(ignore|expect-error|nocheck)|noqa|ruff\s*:|pylint\s*:|nolint/;

const DEFAULT_LIMIT = 400;

const Input = Schema.Struct({
  targets: Schema.Array(Schema.String).annotate({
    description: "Files or directories to inventory, relative to the project directory or absolute.",
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

- \`file\` is relative to the project directory.
- \`kind\` is \`comment\`, \`doc\`, or \`suppression\`. A suppression is a comment with a
  rule attached: eslint-disable, prettier-ignore, biome-ignore, @ts-ignore,
  @ts-expect-error, @ts-nocheck, noqa, ruff:, pylint:, nolint.
- \`total\` and \`suppressions\` count the whole scope. \`hits\` is only the page named by
  \`offset\` and \`limit\`, and \`truncated\` is true when the page is not the whole scope.
- \`errors\` lists the targets that could not be scanned, and \`empty\` the targets that
  produced no hits. An empty result and a failed scan look identical otherwise. A
  bad target never fails the call: every hit that did scan is still returned.

The scan is line-based and lexical, not a parse. A line that opens with a comment
marker inside a string literal is reported as a comment, and a block comment that
trails code on the same line is missed. Both are the cheap direction to be wrong
in: the caller judges every line anyway, so a false positive costs one dismissal
and a false negative costs a grep.`;

const classify = (line: string, inDoc: boolean): Kind => {
  if (SUPPRESSION.test(line)) return "suppression";
  if (inDoc || line.trimStart().startsWith("*")) return "doc";
  return "comment";
};

const opens = (line: string, style: "hash" | "c") =>
  style === "hash" ? line.startsWith("#") : line.startsWith("//") || line.startsWith("/*");

type RawHit = { readonly line: number; readonly kind: Kind; readonly text: string };

const scanFile = (text: string, ext: string): ReadonlyArray<RawHit> => {
  const style = HASH_STYLE.has(ext) ? "hash" : C_STYLE.has(ext) ? "c" : undefined;
  if (style === undefined) return [];

  const hits: Array<RawHit> = [];
  let inBlock = false;
  let inDoc = false;

  for (const [index, raw] of text.split("\n").entries()) {
    const line = raw.trim();
    if (line.length === 0) continue;

    if (inBlock) {
      hits.push({ line: index + 1, kind: classify(line, inDoc), text: line });
      inBlock = !line.includes("*/");
      if (!inBlock) inDoc = false;
      continue;
    }

    if (!opens(line, style)) continue;

    const doc = line.startsWith("/**") || line.startsWith("///");
    hits.push({ line: index + 1, kind: classify(line, doc), text: line });

    const closes = line.includes("*/");
    inBlock = line.startsWith("/*") && !closes;
    inDoc = doc && !closes;
  }

  return hits;
};

const filesIn = async (target: string): Promise<ReadonlyArray<string>> => {
  const stat = await Bun.file(target).stat().catch(() => undefined);
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
  input: { readonly targets: ReadonlyArray<string>; readonly limit?: number; readonly offset?: number },
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
      errors.push({ target: asked, reason: cause instanceof Error ? cause.message : String(cause) });
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
