import type { Health } from "./policy";
import { run } from "./run";
import { codePath } from "./signals";

export interface ShuntConfig {
  readonly minLines: number;
  readonly minBytes: number;
  readonly hugeLines: number;
  readonly hugeBytes: number;
}

export const DEFAULT_SHUNT_CONFIG: ShuntConfig = {
  minLines: 350,
  minBytes: 10 * 1024,
  hugeLines: 1500,
  hugeBytes: 64 * 1024,
};

export const readShuntConfig = (
  env: Record<string, string | undefined> = Bun.env,
): ShuntConfig => {
  const raw = env.SPECTRE_SHUNT_MIN_LINES?.trim();
  if (raw === undefined || !/^\d+$/.test(raw)) return DEFAULT_SHUNT_CONFIG;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return DEFAULT_SHUNT_CONFIG;
  return { ...DEFAULT_SHUNT_CONFIG, minLines: parsed };
};

export type ShuntFormat =
  | { readonly kind: "code"; readonly huge: boolean }
  | { readonly kind: "markdown"; readonly huge: boolean }
  | { readonly kind: "structured"; readonly flavor: "json" | "jsonc" | "toml" }
  | { readonly kind: "tabular"; readonly delimiter: "," | "\t" }
  | { readonly kind: "plain" };

const extensionOf = (path: string): string => {
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const name = path.slice(slash + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot).toLowerCase();
};

export const classifyFormat = (
  path: string,
  lines: number,
  bytes: number,
  cfg: ShuntConfig = DEFAULT_SHUNT_CONFIG,
): ShuntFormat => {
  const ext = extensionOf(path);
  const huge = lines >= cfg.hugeLines || bytes >= cfg.hugeBytes;
  if (ext === ".md" || ext === ".mdx" || ext === ".markdown") {
    return { kind: "markdown", huge };
  }
  if (ext === ".json") return { kind: "structured", flavor: "json" };
  if (ext === ".jsonc") return { kind: "structured", flavor: "jsonc" };
  if (ext === ".toml") return { kind: "structured", flavor: "toml" };
  if (ext === ".csv") return { kind: "tabular", delimiter: "," };
  if (ext === ".tsv") return { kind: "tabular", delimiter: "\t" };
  if (codePath(path)) return { kind: "code", huge };
  return { kind: "plain" };
};

const encoder = new TextEncoder();

export const utf8Bytes = (text: string): number => encoder.encode(text).byteLength;

export const countLines = (text: string): number => {
  if (text.length === 0) return 0;
  let count = 1;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) count += 1;
  }
  return text.charCodeAt(text.length - 1) === 10 ? count - 1 : count;
};

const splitLines = (text: string): string[] => {
  if (text.length === 0) return [];
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
};

export type SummaryAttempt =
  | {
      readonly kind: "summarized";
      readonly text: string;
      readonly rawBytes: number;
      readonly servedBytes: number;
      readonly legendXml?: string;
    }
  | { readonly kind: "fail-open"; readonly reason: string };

export const formatShuntEnvelope = (params: {
  readonly displayPath: string;
  readonly lines: number;
  readonly rawBytes: number;
  readonly kind: ShuntFormat["kind"];
  readonly body: string;
}): string => {
  const kb = (params.rawBytes / 1024).toFixed(1);
  return [
    `[spectre:read-summary] ${params.displayPath} (${params.lines} lines, ${kb} KB, kind=${params.kind})`,
    params.body.trimEnd(),
    `[escape] Summary only (do not edit from this). Read a slice with read({ path: "${params.displayPath}", offset: <line>, limit: <n> }) or repeat read({ path: "${params.displayPath}" }) for the verbatim file.`,
  ].join("\n\n");
};

const MAX_HEADINGS = 120;

type MarkdownFence = { readonly char: "`" | "~"; readonly len: number };

const parseFenceMarker = (
  trimmed: string,
): { readonly char: "`" | "~"; readonly len: number; readonly rest: string } | undefined => {
  const match = /^(`{3,}|~{3,})(.*)$/.exec(trimmed);
  if (match?.[1] === undefined) return undefined;
  const run = match[1];
  return { char: run[0] === "`" ? "`" : "~", len: run.length, rest: match[2] ?? "" };
};

const stepMarkdownFence = (
  trimmed: string,
  fence: MarkdownFence | undefined,
): { readonly fence: MarkdownFence | undefined; readonly isFenceLine: boolean } => {
  const marker = parseFenceMarker(trimmed);
  if (marker === undefined) return { fence, isFenceLine: false };
  if (fence === undefined) {
    if (marker.char === "`" && marker.rest.includes("`")) {
      return { fence: undefined, isFenceLine: false };
    }
    return { fence: { char: marker.char, len: marker.len }, isFenceLine: true };
  }
  const closes =
    marker.char === fence.char && marker.len >= fence.len && marker.rest.trim() === "";
  return { fence: closes ? undefined : fence, isFenceLine: closes };
};

const extractMarkdownHeadings = (rawText: string, totalLines: number): string | undefined => {
  const lines = splitLines(rawText);
  const headings: Array<{ readonly line: number; readonly text: string }> = [];
  let fence: MarkdownFence | undefined;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const step = stepMarkdownFence(line.trimStart(), fence);
    fence = step.fence;
    if (!step.isFenceLine && fence === undefined && /^#{1,6}\s+/.test(line)) {
      headings.push({ line: i + 1, text: line.trimEnd() });
    }
  }

  if (headings.length === 0) return undefined;

  const shown = headings.slice(0, MAX_HEADINGS);
  const out = shown.map((heading, idx) => {
    const next = headings[idx + 1];
    const endLine = next !== undefined ? next.line - 1 : totalLines;
    return `L${heading.line}-L${endLine}: ${heading.text}`;
  });

  if (headings.length > MAX_HEADINGS) {
    out.push(`... (+${headings.length - MAX_HEADINGS} more headings)`);
  }
  return out.join("\n");
};

const scanJsonStringEnd = (line: string, start: number): number => {
  for (let i = start; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === "\\") {
      i += 1;
      continue;
    }
    if (ch === '"') return i;
  }
  return line.length;
};

const decodeJsonString = (token: string): string => {
  try {
    const parsed: unknown = JSON.parse(token);
    return typeof parsed === "string" ? parsed : token.slice(1, -1);
  } catch {
    return token.slice(1, -1);
  }
};

const findBlockCommentEnd = (line: string, start: number): number => {
  const idx = line.indexOf("*/", start);
  return idx === -1 ? -1 : idx + 2;
};

const readDepthOneKey = (
  line: string,
  quoteStart: number,
  quoteEnd: number,
  depth: number,
): string | undefined => {
  if (depth !== 1 || quoteEnd >= line.length) return undefined;
  if (!line.slice(quoteEnd + 1).trimStart().startsWith(":")) return undefined;
  return decodeJsonString(line.slice(quoteStart, quoteEnd + 1));
};

const stepJsonChar = (ch: string, depth: number): number => {
  if (ch === "{" || ch === "[") return depth + 1;
  if (ch === "}" || ch === "]") return Math.max(0, depth - 1);
  return depth;
};

type JsonLineState = {
  readonly nextDepth: number;
  readonly nextBlockComment: boolean;
  readonly keys: readonly string[];
};

const scanJsonLineKeys = (
  line: string,
  depth: number,
  inBlockComment: boolean,
): JsonLineState => {
  let d = depth;
  const keys: string[] = [];
  let i = inBlockComment ? findBlockCommentEnd(line, 0) : 0;
  if (i < 0) return { nextDepth: d, nextBlockComment: true, keys };

  while (i < line.length) {
    const pair = line.slice(i, i + 2);
    if (pair === "//") break;
    if (pair === "/*") {
      const end = findBlockCommentEnd(line, i + 2);
      if (end < 0) return { nextDepth: d, nextBlockComment: true, keys };
      i = end;
      continue;
    }
    if (line[i] === '"') {
      const end = scanJsonStringEnd(line, i + 1);
      const key = readDepthOneKey(line, i, end, d);
      if (key !== undefined) keys.push(key);
      i = end + 1;
      continue;
    }
    d = stepJsonChar(line[i] ?? "", d);
    i += 1;
  }

  return { nextDepth: d, nextBlockComment: false, keys };
};

const scanJsonTopLevelLines = (rawText: string): ReadonlyMap<string, number> => {
  const map = new Map<string, number>();
  const lines = splitLines(rawText);
  let depth = 0;
  let inBlockComment = false;
  for (let i = 0; i < lines.length; i += 1) {
    const res = scanJsonLineKeys(lines[i] ?? "", depth, inBlockComment);
    depth = res.nextDepth;
    inBlockComment = res.nextBlockComment;
    for (const key of res.keys) {
      if (!map.has(key)) map.set(key, i + 1);
    }
  }
  return map;
};

type TomlQuote = '"""' | "'''";

const readTomlKeySegment = (
  text: string,
  start: number,
): { readonly key: string; readonly next: number } | undefined => {
  const lead = /^[ \t]*/.exec(text.slice(start))?.[0].length ?? 0;
  const pos = start + lead;
  const ch = text[pos];
  if (ch === undefined) return undefined;
  if (ch === '"') {
    const end = scanJsonStringEnd(text, pos + 1);
    if (end >= text.length) return undefined;
    return { key: decodeJsonString(text.slice(pos, end + 1)), next: end + 1 };
  }
  if (ch === "'") {
    const end = text.indexOf("'", pos + 1);
    if (end < 0) return undefined;
    return { key: text.slice(pos + 1, end), next: end + 1 };
  }
  const bare = /^[A-Za-z0-9_-]+/.exec(text.slice(pos));
  if (bare === null) return undefined;
  return { key: bare[0], next: pos + bare[0].length };
};

const parseTomlKeyPath = (
  text: string,
  start: number,
  terminator: "=" | "]",
): string | undefined => {
  const first = readTomlKeySegment(text, start);
  if (first === undefined) return undefined;
  let pos = first.next;
  while (pos < text.length) {
    pos += /^[ \t]*/.exec(text.slice(pos))?.[0].length ?? 0;
    if (text[pos] === terminator) return first.key;
    if (text[pos] !== ".") return undefined;
    const nextSeg = readTomlKeySegment(text, pos + 1);
    if (nextSeg === undefined) return undefined;
    pos = nextSeg.next;
  }
  return undefined;
};

const tomlLineKey = (
  trimmed: string,
  inTable: boolean,
): { readonly key: string; readonly isTable: boolean } | undefined => {
  if (trimmed === "" || trimmed.startsWith("#")) return undefined;
  if (trimmed.startsWith("[")) {
    const start = trimmed.startsWith("[[") ? 2 : 1;
    const key = parseTomlKeyPath(trimmed, start, "]");
    return key === undefined ? undefined : { key, isTable: true };
  }
  if (inTable) return undefined;
  const key = parseTomlKeyPath(trimmed, 0, "=");
  return key === undefined ? undefined : { key, isTable: false };
};

const scanTomlCloseMultiline = (line: string, start: number, quote: TomlQuote): number => {
  let i = start;
  const quoteChar = quote[0];
  while (i < line.length) {
    if (quote === '"""' && line[i] === "\\") {
      i += 2;
      continue;
    }
    if (line.startsWith(quote, i)) {
      i += 3;
      for (let extra = 0; extra < 2 && line[i] === quoteChar; extra += 1) i += 1;
      return i;
    }
    i += 1;
  }
  return -1;
};

type TomlScanStep =
  | { readonly kind: "done" }
  | { readonly kind: "open"; readonly quote: TomlQuote; readonly next: number }
  | { readonly kind: "advance"; readonly next: number };

const stepTomlOutsideQuote = (line: string, i: number): TomlScanStep => {
  const ch = line[i];
  if (ch === "#") return { kind: "done" };
  if (line.startsWith('"""', i)) return { kind: "open", quote: '"""', next: i + 3 };
  if (line.startsWith("'''", i)) return { kind: "open", quote: "'''", next: i + 3 };
  if (ch === '"') return { kind: "advance", next: scanJsonStringEnd(line, i + 1) + 1 };
  if (ch === "'") {
    const end = line.indexOf("'", i + 1);
    return end < 0 ? { kind: "done" } : { kind: "advance", next: end + 1 };
  }
  return { kind: "advance", next: i + 1 };
};

const advanceTomlMultiline = (
  line: string,
  current: TomlQuote | undefined,
): TomlQuote | undefined => {
  let quote = current;
  let i = 0;
  while (i < line.length) {
    if (quote !== undefined) {
      const next = scanTomlCloseMultiline(line, i, quote);
      if (next < 0) return quote;
      quote = undefined;
      i = next;
      continue;
    }
    const step = stepTomlOutsideQuote(line, i);
    if (step.kind === "done") break;
    if (step.kind === "open") quote = step.quote;
    i = step.next;
  }
  return quote;
};

const scanTomlTopLevelLines = (rawText: string): ReadonlyMap<string, number> => {
  const map = new Map<string, number>();
  const lines = splitLines(rawText);
  let inTable = false;
  let multiline: TomlQuote | undefined;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (multiline === undefined) {
      const hit = tomlLineKey(line.trim(), inTable);
      if (hit !== undefined) {
        if (hit.isTable) inTable = true;
        if (!map.has(hit.key)) map.set(hit.key, i + 1);
      }
    }
    multiline = advanceTomlMultiline(line, multiline);
  }
  return map;
};

const MAX_SCHEMA_LINES = 120;
const MAX_SCHEMA_DEPTH = 4;

const describeScalar = (value: unknown): string => {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    const elemType = value.length === 0 ? "unknown" : describeScalar(value[0]);
    return `array<${elemType}>[${value.length}]`;
  }
  if (typeof value === "object") return `object(${Object.keys(value).length})`;
  return typeof value;
};

const nestedSchemaTarget = (value: unknown): unknown => {
  if (typeof value !== "object" || value === null) return undefined;
  if (!Array.isArray(value)) return value;
  const first: unknown = value[0];
  return typeof first === "object" && first !== null ? first : undefined;
};

const emitObjectSchema = (
  record: object,
  depth: number,
  topLines: ReadonlyMap<string, number>,
  out: string[],
): void => {
  const indent = "  ".repeat(depth);
  for (const [key, entry] of Object.entries(record)) {
    if (out.length >= MAX_SCHEMA_LINES) return;
    const lineNum = depth === 0 ? topLines.get(key) : undefined;
    const lineTag = lineNum !== undefined ? ` @L${lineNum}` : "";
    out.push(`${indent}${key}${lineTag}: ${describeScalar(entry)}`);
    if (depth + 1 >= MAX_SCHEMA_DEPTH) continue;
    const target = nestedSchemaTarget(entry);
    if (target !== undefined) emitSchema(target, depth + 1, topLines, out);
  }
};

const emitSchema = (
  value: unknown,
  depth: number,
  topLines: ReadonlyMap<string, number>,
  out: string[],
): void => {
  if (out.length >= MAX_SCHEMA_LINES) return;
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    emitObjectSchema(value, depth, topLines, out);
    return;
  }
  if (depth === 0) out.push(`(root): ${describeScalar(value)}`);
  const target = Array.isArray(value) && depth < MAX_SCHEMA_DEPTH ? nestedSchemaTarget(value) : undefined;
  if (target !== undefined) emitSchema(target, depth + 1, topLines, out);
};

const summarizeStructured = (
  rawText: string,
  flavor: "json" | "jsonc" | "toml",
): { readonly ok: true; readonly body: string } | { readonly ok: false; readonly reason: string } => {
  let parsed: unknown;
  try {
    parsed = flavor === "toml" ? Bun.TOML.parse(rawText) : Bun.JSONC.parse(rawText);
  } catch {
    return { ok: false, reason: "parse-error" };
  }

  const topLines =
    flavor === "toml" ? scanTomlTopLevelLines(rawText) : scanJsonTopLevelLines(rawText);
  const out: string[] = [];
  emitSchema(parsed, 0, topLines, out);

  if (out.length >= MAX_SCHEMA_LINES) {
    out.push(`... (truncated at ${MAX_SCHEMA_LINES} schema lines)`);
  }
  return { ok: true, body: out.length === 0 ? "(empty)" : out.join("\n") };
};

const splitDelimited = (line: string, delimiter: "," | "\t"): string[] => {
  if (delimiter === "\t") return line.split("\t");
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i] ?? "";
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
};

const formatLineRange = (lines: readonly string[], startIdx: number, endIdx: number): string[] => {
  const out: string[] = [];
  for (let i = startIdx; i < endIdx; i += 1) {
    out.push(`L${i + 1}: ${lines[i] ?? ""}`);
  }
  return out;
};

const summarizeTabular = (rawText: string, delimiter: "," | "\t"): string => {
  const lines = splitLines(rawText);
  const total = lines.length;
  if (total === 0) return "rows: 0";

  const headers = splitDelimited(lines[0] ?? "", delimiter);
  const headEnd = Math.min(15, total);
  const tailStart = Math.max(headEnd, total - 10);

  const sections = [
    `rows: ${total}`,
    `columns (${headers.length}): ${headers.join(", ")}`,
    `--- head (L1-L${headEnd}) ---`,
    ...formatLineRange(lines, 0, headEnd),
  ];

  if (tailStart < total) {
    sections.push(`--- tail (L${tailStart + 1}-L${total}) ---`);
    sections.push(...formatLineRange(lines, tailStart, total));
  }

  return sections.join("\n");
};

const WARN_ERROR_PATTERN = /\b(ERRORS?|FATAL|PANIC\w*|EXCEPTIONS?|WARN(?:ING)?|FAIL(?:ED|URE)?)\b/i;

const summarizePlain = (rawText: string, rawBytes: number): string => {
  const lines = splitLines(rawText);
  const total = lines.length;
  if (total === 0) return `lines: 0, bytes: ${rawBytes}`;

  const headEnd = Math.min(20, total);
  const tailStart = Math.max(headEnd, total - 20);
  const alerts: string[] = [];

  for (let i = headEnd; i < tailStart && alerts.length < 15; i += 1) {
    const line = lines[i] ?? "";
    if (WARN_ERROR_PATTERN.test(line)) {
      alerts.push(`L${i + 1}: ${line}`);
    }
  }

  const sections = [
    `lines: ${total}, bytes: ${rawBytes}`,
    `--- head (L1-L${headEnd}) ---`,
    ...formatLineRange(lines, 0, headEnd),
  ];

  if (alerts.length > 0) {
    sections.push(`--- error/warn (${alerts.length}) ---`);
    sections.push(...alerts);
  }

  if (tailStart < total) {
    sections.push(`--- tail (L${tailStart + 1}-L${total}) ---`);
    sections.push(...formatLineRange(lines, tailStart, total));
  }

  return sections.join("\n");
};

const isRipwireSuccess = (status: string, answer: string): boolean =>
  (status === "answered" || status === "partial") && answer.trim() !== "";

const summarizeWithRipwire = async (params: {
  readonly root: string;
  readonly resolvedPath: string;
  readonly huge: boolean;
  readonly legendSeenFile?: string;
  readonly runner: typeof run;
}): Promise<
  | { readonly ok: true; readonly body: string; readonly legendXml: string }
  | { readonly ok: false; readonly reason: string }
> => {
  const legendArgs =
    params.legendSeenFile !== undefined && params.legendSeenFile !== ""
      ? [`--legend-seen=${params.legendSeenFile}`]
      : [];
  const maxTokens = params.huge ? "--max-tokens=1200" : "--max-tokens=2000";
  const res = await params.runner(params.root, [
    params.resolvedPath,
    "--pack-signatures",
    maxTokens,
    ...legendArgs,
  ]);
  if (!isRipwireSuccess(res.status, res.answer)) {
    return { ok: false, reason: `ripwire-${res.status}` };
  }
  return { ok: true, body: res.answer.trim(), legendXml: res.answer };
};

const summarizeCodeOrMarkdown = async (params: {
  readonly root: string;
  readonly resolvedPath: string;
  readonly format: Extract<ShuntFormat, { readonly kind: "code" | "markdown" }>;
  readonly rawText: string;
  readonly lines: number;
  readonly health: Health;
  readonly legendSeenFile?: string;
  readonly runRipwire?: typeof run;
}): Promise<
  | { readonly ok: true; readonly body: string; readonly legendXml?: string }
  | { readonly ok: false; readonly reason: string }
> => {
  if (params.health.kind !== "ready") {
    if (params.format.kind === "code") {
      return { ok: false, reason: "ripwire-not-ready" };
    }
    const headings = extractMarkdownHeadings(params.rawText, params.lines);
    return headings === undefined
      ? { ok: false, reason: "no-markdown-headings" }
      : { ok: true, body: headings };
  }

  const ripwireRes = await summarizeWithRipwire({
    root: params.root,
    resolvedPath: params.resolvedPath,
    huge: params.format.huge,
    legendSeenFile: params.legendSeenFile,
    runner: params.runRipwire ?? run,
  });

  if (ripwireRes.ok) return ripwireRes;

  if (params.format.kind === "markdown") {
    const headings = extractMarkdownHeadings(params.rawText, params.lines);
    if (headings !== undefined) return { ok: true, body: headings };
  }
  return ripwireRes;
};

type SummarizeParams = {
  readonly root: string;
  readonly resolvedPath: string;
  readonly displayPath: string;
  readonly format: ShuntFormat;
  readonly rawText: string;
  readonly rawBytes: number;
  readonly pageBytes?: number;
  readonly lines: number;
  readonly health: Health;
  readonly legendSeenFile?: string;
  readonly runRipwire?: typeof run;
};

const extractBody = async (
  params: SummarizeParams,
): Promise<
  | { readonly ok: true; readonly body: string; readonly legendXml?: string }
  | { readonly ok: false; readonly reason: string }
> => {
  switch (params.format.kind) {
    case "code":
    case "markdown":
      return summarizeCodeOrMarkdown({
        root: params.root,
        resolvedPath: params.resolvedPath,
        format: params.format,
        rawText: params.rawText,
        lines: params.lines,
        health: params.health,
        legendSeenFile: params.legendSeenFile,
        runRipwire: params.runRipwire,
      });
    case "structured":
      return summarizeStructured(params.rawText, params.format.flavor);
    case "tabular":
      return { ok: true, body: summarizeTabular(params.rawText, params.format.delimiter) };
    case "plain":
      return { ok: true, body: summarizePlain(params.rawText, params.rawBytes) };
  }
};

export const summarizeFile = async (params: SummarizeParams): Promise<SummaryAttempt> => {
  const extracted = await extractBody(params);
  if (!extracted.ok) return { kind: "fail-open", reason: extracted.reason };

  const text = formatShuntEnvelope({
    displayPath: params.displayPath,
    lines: params.lines,
    rawBytes: params.rawBytes,
    kind: params.format.kind,
    body: extracted.body,
  });
  const servedBytes = utf8Bytes(text);
  const pageBytes = params.pageBytes ?? params.rawBytes;

  if (servedBytes >= pageBytes) {
    return { kind: "fail-open", reason: "no-savings" };
  }

  return {
    kind: "summarized",
    text,
    rawBytes: pageBytes,
    servedBytes,
    ...(extracted.legendXml === undefined ? {} : { legendXml: extracted.legendXml }),
  };
};
