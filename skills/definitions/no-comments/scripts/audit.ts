/**
 * Inventory every comment and every lint or type suppression in a scope.
 *
 * This is what `no-comments` step 2 runs instead of a hand-rolled `grep`, so the
 * audit of what the subagent missed is a total list rather than whatever pattern
 * the reader happened to type. It is deliberately an inventory and not a
 * judgment: it cannot apply Sicko's keep list, so every line it prints still
 * goes through the same keep list as the subagent's own findings.
 *
 *   bun run scripts/audit.ts src/ skills/
 *
 * Paths may be files or directories. Output is grouped by file, in path order,
 * and truncated at NO_COMMENTS_AUDIT_LIMIT lines (default 400) so a wide scope
 * cannot flood the reader it is feeding.
 *
 * The scan is line-based and lexical, not a parse. A line that opens with a
 * comment marker inside a string literal is reported as a comment, and a block
 * comment that trails code on the same line is missed. Both are the cheap
 * direction to be wrong in: the reader judges every line anyway, so a false
 * positive costs one dismissal and a false negative costs a grep.
 */
const LIMIT = Number(Bun.env.NO_COMMENTS_AUDIT_LIMIT ?? 400);
const SKIP = new Set(["node_modules", ".git", "dist", "build", "coverage", ".next", ".turbo"]);

/** C-style line and block comments. */
const C_STYLE = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
/** Everything else this repo touches that spells a line comment with a hash. */
const HASH_STYLE = new Set([".py", ".sh", ".rb", ".yml", ".yaml", ".toml"]);

/** A suppression is never a comment: it is a comment with a rule attached. */
const SUPPRESSION =
  /eslint-disable|prettier-ignore|biome-ignore|@ts-(ignore|expect-error|nocheck)|noqa|ruff\s*:|pylint\s*:|nolint/;

type Hit = { readonly line: number; readonly kind: string; readonly text: string };

const classify = (line: string, inDoc: boolean) => {
  if (SUPPRESSION.test(line)) return "suppression";
  if (inDoc || line.trimStart().startsWith("*")) return "doc";
  return "comment";
};

/** Does this line open a comment? Hash style has no block form. */
const opens = (line: string, style: "hash" | "c") =>
  style === "hash" ? line.startsWith("#") : line.startsWith("//") || line.startsWith("/*");

const scan = (text: string, ext: string): ReadonlyArray<Hit> => {
  const style = HASH_STYLE.has(ext) ? "hash" : C_STYLE.has(ext) ? "c" : undefined;
  if (style === undefined) return [];

  const hits: Array<Hit> = [];
  let inBlock = false;
  let inDoc = false;

  for (const [index, raw] of text.split("\n").entries()) {
    const line = raw.trim();
    if (line.length === 0) continue;

    // Inside a block comment every line belongs to it, doc or not, until it closes.
    if (inBlock) {
      hits.push({ line: index + 1, kind: classify(line, inDoc), text: line });
      inBlock = !line.includes("*/");
      if (!inBlock) inDoc = false;
      continue;
    }

    if (!opens(line, style)) continue;

    const doc = line.startsWith("/**") || line.startsWith("///");
    hits.push({ line: index + 1, kind: classify(line, doc), text: line });

    // A one-line comment is a whole comment, not an open block.
    const closes = line.includes("*/");
    inBlock = line.startsWith("/*") && !closes;
    inDoc = doc && !closes;
  }

  return hits;
};

const filesIn = async (target: string): Promise<ReadonlyArray<string>> => {
  const stat = await Bun.file(target).stat().catch(() => undefined);
  if (stat === undefined) {
    await Bun.write(Bun.stderr, `No such file or directory: ${target}\n`);
    process.exit(1);
  }
  if (stat.isFile()) return [target];

  const glob = new Bun.Glob("**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs,py,sh,rb,yml,yaml,toml}");
  const found: Array<string> = [];

  for await (const entry of glob.scan({ cwd: target, absolute: true, dot: false })) {
    if (entry.split("/").some((part) => SKIP.has(part))) continue;
    found.push(entry);
  }

  return found.toSorted();
};

const targets = Bun.argv.slice(2);
if (targets.length === 0) {
  await Bun.write(Bun.stderr, "usage: bun run scripts/audit.ts <file-or-directory>...\n");
  process.exit(2);
}

const lines: Array<string> = [];
const empty: Array<string> = [];
let total = 0;
let suppressions = 0;
let scanned = 0;

for (const target of targets) {
  const files = await filesIn(target);
  let hitsInTarget = 0;

  for (const file of files) {
    if (lines.length >= LIMIT) break;
    const ext = file.slice(file.lastIndexOf("."));
    const hits = scan(await Bun.file(file).text(), ext);
    if (hits.length === 0) continue;

    scanned += 1;
    hitsInTarget += hits.length;
    lines.push(file);
    for (const hit of hits) {
      if (lines.length >= LIMIT) break;
      lines.push(`  ${hit.line}: ${hit.kind.padEnd(11)} ${hit.text}`);
      total += 1;
      if (hit.kind === "suppression") suppressions += 1;
    }
  }

  // Say so out loud: an empty result and a failed scan look identical otherwise.
  if (hitsInTarget === 0) empty.push(target);
}

await Bun.write(
  Bun.stdout,
  [
    lines.join("\n"),
    ...empty.map((target) => `no comments found in ${target}`),
    "",
    `${total} comment lines, ${suppressions} suppressions, across ${scanned} files`,
    ...(lines.length >= LIMIT
      ? [`truncated at the ${LIMIT}-line report cap; raise NO_COMMENTS_AUDIT_LIMIT to see the rest`]
      : []),
    "",
  ].join("\n"),
);
