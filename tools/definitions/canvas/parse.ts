/**
 * Unified diff text in, per-file rows out. Pure: no disk, no network, no `gh`,
 * no clock. The only module in the canvas feature testable with no host.
 *
 * Counting rule, measured on PR 16: `gh pr diff <n> --patch` wraps the diff in
 * a `git format-patch` mail document whose prose body is full of `-` bullets.
 * A deletion count over that output reads `56 18` against a truth of `56 15`.
 * So this parser counts only `+`/`-` lines inside `@@` hunks, anchored at the
 * line start, and refuses `--patch` mail outright rather than misreading it.
 */

export type HunkRow = {
  readonly kind: "hunk";
  readonly header: string;
};

export type ContextRow = {
  readonly kind: "context";
  readonly old: number;
  readonly new: number;
  readonly text: string;
};

export type RemovedRow = {
  readonly kind: "removed";
  readonly old: number;
  readonly text: string;
};

export type AddedRow = {
  readonly kind: "added";
  readonly new: number;
  readonly text: string;
};

export type DiffRow = HunkRow | ContextRow | RemovedRow | AddedRow;

export type ReadFile = {
  readonly status: "read";
  readonly index: number;
  readonly path: string;
  readonly rows: ReadonlyArray<DiffRow>;
  readonly additions: number;
  readonly deletions: number;
};

export type UnreadableFile = {
  readonly status: "unreadable";
  readonly index: number;
  readonly path: string;
  readonly reason: string;
};

export type ParsedFile = ReadFile | UnreadableFile;

export type ParseResult =
  | { readonly status: "parsed"; readonly files: ReadonlyArray<ParsedFile> }
  | { readonly status: "unreadable"; readonly reason: string };

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

const DIFF_GIT = "diff --git ";

const splitPaths = (rest: string): ReadonlyArray<string> => {
  const parts: Array<string> = [];
  let current = "";
  let quoted = false;
  for (const char of rest) {
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === " " && !quoted) {
      if (current !== "") {
        parts.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current !== "") parts.push(current);
  return parts;
};

const stripPrefix = (value: string): string =>
  value.startsWith("a/") || value.startsWith("b/") ? value.slice(2) : value;

const pathFromDiffGit = (line: string): string | null => {
  const parts = splitPaths(line.slice(DIFF_GIT.length));
  const first = parts[0];
  const second = parts[1];
  if (first === undefined || second === undefined || parts.length !== 2) return null;
  if (second === "/dev/null") return stripPrefix(first);
  return stripPrefix(second);
};

const pathFromPlusMinus = (line: string, marker: string): string | null => {
  const rest = line.slice(marker.length).trim();
  if (rest === "") return null;
  const file = (rest.split("\t")[0] ?? "").trim();
  if (file === "" || file === "/dev/null") return null;
  const unquoted = file.startsWith('"') && file.endsWith('"') ? file.slice(1, -1) : file;
  return stripPrefix(unquoted);
};

const pathOfSection = (lines: ReadonlyArray<string>): string | null => {
  const header = lines[0] ?? "";
  const fromGit = pathFromDiffGit(header);
  if (fromGit !== null) return fromGit;
  let minus: string | null = null;
  for (const line of lines) {
    if (line.startsWith("+++ ")) {
      const plus = pathFromPlusMinus(line, "+++");
      if (plus !== null) return plus;
    } else if (line.startsWith("--- ")) {
      const found = pathFromPlusMinus(line, "---");
      if (found !== null) minus = found;
    }
  }
  return minus;
};

type Body = {
  readonly rows: Array<DiffRow>;
  readonly sawHunk: boolean;
};

const parseBody = (lines: ReadonlyArray<string>): Body => {
  const rows: Array<DiffRow> = [];
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  let sawHunk = false;

  for (const line of lines.slice(1)) {
    if (line.startsWith("@@")) {
      const match = HUNK.exec(line);
      const oldStart = match?.[1];
      const newStart = match?.[3];
      if (match === null || oldStart === undefined || newStart === undefined) {
        inHunk = false;
        continue;
      }
      oldLine = Number(oldStart);
      newLine = Number(newStart);
      inHunk = true;
      sawHunk = true;
      rows.push({ kind: "hunk", header: line });
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith("\\")) continue;
    const marker = line.charAt(0);
    if (marker === " " || line === "") {
      const text = line === "" ? "" : line.slice(1);
      rows.push({ kind: "context", old: oldLine, new: newLine, text });
      oldLine += 1;
      newLine += 1;
    } else if (marker === "-") {
      rows.push({ kind: "removed", old: oldLine, text: line.slice(1) });
      oldLine += 1;
    } else if (marker === "+") {
      rows.push({ kind: "added", new: newLine, text: line.slice(1) });
      newLine += 1;
    } else {
      inHunk = false;
    }
  }

  return { rows, sawHunk };
};

const looksLikePatchMail = (text: string): boolean =>
  /^From [0-9a-f]{5,} /m.test(text) && /Subject:\s*\[PATCH/.test(text);

const parseSection = (lines: ReadonlyArray<string>, index: number): ParsedFile => {
  const path = pathOfSection(lines) ?? `file-${index}`;
  const joined = lines.join("\n");

  if (/^Binary files .* differ/m.test(joined) || joined.includes("GIT binary patch"))
    return { status: "unreadable", index, path, reason: "binary file, no text rows" };
  if (joined.includes("Subproject commit"))
    return { status: "unreadable", index, path, reason: "submodule change, no text rows" };

  const { rows, sawHunk } = parseBody(lines);
  if (!sawHunk) {
    if (/^(old|new) mode/m.test(joined))
      return { status: "unreadable", index, path, reason: "mode-only change, no content rows" };
    return { status: "unreadable", index, path, reason: "no hunks found, no rows to read" };
  }

  let additions = 0;
  let deletions = 0;
  for (const row of rows) {
    if (row.kind === "added") additions += 1;
    else if (row.kind === "removed") deletions += 1;
  }
  return { status: "read", index, path, rows, additions, deletions };
};

/**
 * Parse unified diff text into per-file rows. Never throws: a section that
 * cannot be read becomes an `unreadable` file, and input that is not a diff
 * at all becomes an `unreadable` result. Rows keep diff order, so a run of
 * `-` lines followed by a run of `+` lines aligns index-wise with the longer
 * side's tail left unmatched rather than padded.
 */
export const parseDiff = (text: string): ParseResult => {
  if (text.trim() === "") return { status: "parsed", files: [] };
  if (looksLikePatchMail(text))
    return {
      status: "unreadable",
      reason:
        "refusing format-patch (--patch) output: re-run without --patch so prose is not counted as deletions",
    };

  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  const starts: Array<number> = [];
  for (const [at, line] of lines.entries()) {
    if (line.startsWith(DIFF_GIT)) starts.push(at);
  }
  if (starts.length === 0)
    return {
      status: "unreadable",
      reason: "no `diff --git` headers found; expected unified diff output",
    };

  const files: Array<ParsedFile> = [];
  for (const [position, start] of starts.entries()) {
    const end = starts[position + 1];
    const section = end === undefined ? lines.slice(start) : lines.slice(start, end);
    files.push(parseSection(section, position + 1));
  }
  return { status: "parsed", files };
};
