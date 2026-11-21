export type LanguageFamily =
  | "code"
  | "json"
  | "shell"
  | "markup"
  | "css"
  | "sql"
  | "yaml"
  | "plain";

export type TokenKind = "k" | "s" | "c" | "n" | "t" | "f" | "p";

type CodeFamily = "code" | "json" | "shell" | "sql";

const wordSet = (words: string): ReadonlySet<string> => new Set(words.trim().split(/\s+/));

const CODE_KEYWORDS = wordSet(
  "as async await break case catch class const continue crate def default defer delete do elif else enum export extends false final finally fn for from func function go if impl implements import in interface is lambda let loop match mod move mut namespace never new nil None null of override package pass priv private protected pub public raise readonly ref return satisfies self Self static struct super switch then this throw trait true True False try type typeof undefined union unsafe use var void where while with yield",
);

const SHELL_KEYWORDS = wordSet(
  "case cd do done echo elif else esac eval exec exit export fi for function if in local printf read readonly return select set shift source then trap unset until while",
);

const SQL_KEYWORDS = wordSet(
  "add all alter and as asc between by case check column constraint create cross database default delete desc distinct drop else end exists false foreign from full group having if in index inner insert into is join key left like limit not null offset on or order outer primary references returning right select set table then true union unique update using values view when where with",
);

const JSON_KEYWORDS = wordSet("true false null");

const FAMILY_BY_ALIAS: Readonly<Record<string, LanguageFamily>> = {
  ts: "code",
  tsx: "code",
  typescript: "code",
  js: "code",
  jsx: "code",
  javascript: "code",
  mjs: "code",
  cjs: "code",
  py: "code",
  python: "code",
  rs: "code",
  rust: "code",
  go: "code",
  golang: "code",
  java: "code",
  kt: "code",
  kotlin: "code",
  c: "code",
  h: "code",
  cpp: "code",
  cc: "code",
  cxx: "code",
  hpp: "code",
  cs: "code",
  csharp: "code",
  swift: "code",
  rb: "code",
  ruby: "code",
  php: "code",
  zig: "code",
  lua: "code",
  json: "json",
  jsonc: "json",
  jsonl: "json",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  shell: "shell",
  console: "shell",
  html: "markup",
  htm: "markup",
  xml: "markup",
  svg: "markup",
  css: "css",
  scss: "css",
  less: "css",
  sql: "sql",
  sqlite: "sql",
  postgres: "sql",
  postgresql: "sql",
  yaml: "yaml",
  yml: "yaml",
  toml: "yaml",
  ini: "yaml",
  env: "yaml",
};

export const familyForLanguage = (raw: string | undefined): LanguageFamily => {
  if (raw === undefined) return "plain";
  const cleaned = raw.trim().toLowerCase().replace(/^language-/, "");
  return FAMILY_BY_ALIAS[cleaned] ?? "plain";
};

export const languageForPath = (filePath: string): string => {
  const slash = filePath.lastIndexOf("/");
  const base = (slash === -1 ? filePath : filePath.slice(slash + 1)).toLowerCase();
  if (base === "dockerfile" || base.startsWith("dockerfile.")) return "sh";
  if (base === "makefile" || base === "justfile") return "sh";
  if (base.startsWith(".env")) return "yaml";
  const dot = base.lastIndexOf(".");
  if (dot === -1 || dot === base.length - 1) return "plain";
  return base.slice(dot + 1);
};

const span = (kind: TokenKind, text: string): string =>
  `<span class="hl-${kind}">${Bun.escapeHTML(text)}</span>`;

const NUMBER_TOKEN = /^(?:0[xXoObB][0-9a-fA-F_]+|[0-9][0-9_]*(?:\.[0-9_]+)?(?:[eE][+-]?[0-9_]+)?n?)/;

const scanQuoted = (line: string, start: number, quote: string): number => {
  let index = start + quote.length;
  while (index < line.length) {
    if (line.charAt(index) === "\\") {
      index += 2;
      continue;
    }
    if (line.startsWith(quote, index)) return index + quote.length;
    index += 1;
  }
  return line.length;
};

const nextNonSpace = (line: string, from: number): string => {
  const rest = line.slice(from).trimStart();
  return rest.charAt(0);
};

const WORD_KEYWORDS: Readonly<Record<CodeFamily, ReadonlySet<string>>> = {
  code: CODE_KEYWORDS,
  json: JSON_KEYWORDS,
  shell: SHELL_KEYWORDS,
  sql: SQL_KEYWORDS,
};

const classifyWord = (word: string, trailing: string, family: CodeFamily): TokenKind | undefined => {
  const probe = family === "sql" ? word.toLowerCase() : word;
  if (WORD_KEYWORDS[family].has(probe)) return "k";
  if (family === "json") return undefined;
  if (family === "shell") return trailing === "=" ? "p" : undefined;
  if (family === "code" && /^[A-Z][A-Za-z0-9_]*$/.test(word)) return "t";
  return trailing === "(" ? "f" : undefined;
};

const lineCommentAt = (line: string, index: number, family: CodeFamily): boolean => {
  const pair = line.slice(index, index + 2);
  if (pair === "//") return true;
  if (family === "sql" && pair === "--") return true;
  if ((family === "shell" || family === "code") && line.charAt(index) === "#") {
    return index === 0 || /\s/.test(line.charAt(index - 1));
  }
  return false;
};

type Step = { readonly html: string; readonly end: number };

const tryStepCommentOrQuote = (line: string, index: number, family: CodeFamily): Step | undefined => {
  if (lineCommentAt(line, index, family)) {
    return { html: span("c", line.slice(index)), end: line.length };
  }
  if (line.startsWith("/*", index)) {
    const close = line.indexOf("*/", index + 2);
    const end = close === -1 ? line.length : close + 2;
    return { html: span("c", line.slice(index, end)), end };
  }
  const ch = line.charAt(index);
  if (ch === '"' || ch === "'" || ch === "`") {
    const end = scanQuoted(line, index, ch);
    const isJsonKey = family === "json" && ch === '"' && nextNonSpace(line, end) === ":";
    return { html: span(isJsonKey ? "p" : "s", line.slice(index, end)), end };
  }
  return undefined;
};

const tryStepToken = (line: string, index: number, family: CodeFamily): Step | undefined => {
  const rest = line.slice(index);
  if (family === "shell") {
    const shellVar = /^\$(?:\{[^}]*\}|[A-Za-z0-9_@*#?-]+)/.exec(rest);
    if (shellVar !== null) {
      return { html: span("p", shellVar[0]), end: index + shellVar[0].length };
    }
  }
  const decorator = /^@[A-Za-z_$][A-Za-z0-9_$]*/.exec(rest);
  if (decorator !== null) {
    return { html: span("t", decorator[0]), end: index + decorator[0].length };
  }
  const num = NUMBER_TOKEN.exec(rest);
  if (num !== null) {
    return { html: span("n", num[0]), end: index + num[0].length };
  }
  const ident = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(rest);
  if (ident !== null) {
    const word = ident[0];
    const end = index + word.length;
    const kind = classifyWord(word, nextNonSpace(line, end), family);
    return { html: kind === undefined ? Bun.escapeHTML(word) : span(kind, word), end };
  }
  return undefined;
};

const highlightCodeLine = (line: string, family: CodeFamily): string => {
  let out = "";
  let index = 0;
  while (index < line.length) {
    const matched =
      tryStepCommentOrQuote(line, index, family) ?? tryStepToken(line, index, family);
    if (matched !== undefined) {
      out += matched.html;
      index = matched.end;
      continue;
    }
    out += Bun.escapeHTML(line.charAt(index));
    index += 1;
  }
  return out;
};

const highlightKeyedLine = (line: string, pattern: RegExp, commentPrefixes: ReadonlyArray<string>): string => {
  const trimmed = line.trimStart();
  if (commentPrefixes.some((prefix) => trimmed.startsWith(prefix))) return span("c", line);
  const match = pattern.exec(line);
  if (match === null) return highlightCodeLine(line, "code");
  return `${Bun.escapeHTML(match[1] ?? "")}${span("p", match[2] ?? "")}${Bun.escapeHTML(match[3] ?? "")}${highlightCodeLine(match[4] ?? "", "code")}`;
};

const YAML_KEY = /^(\s*(?:-\s+)?)([A-Za-z0-9_.-]+)(\s*[:=])(.*)$/;
const CSS_PROP = /^(\s*)(--?[A-Za-z0-9_-]+)(\s*:)(.*)$/;

const highlightMarkupTag = (tag: string): string => {
  if (tag.startsWith("<!--")) return span("c", tag);
  const head = /^(<\/?|<!)([A-Za-z0-9:_-]+)?([\s\S]*)$/.exec(tag);
  if (head === null) return Bun.escapeHTML(tag);
  const open = Bun.escapeHTML(head[1] ?? "");
  const name = head[2] !== undefined && head[2] !== "" ? span("t", head[2]) : "";
  const rest = head[3] ?? "";
  let attrs = "";
  let index = 0;
  while (index < rest.length) {
    const ch = rest.charAt(index);
    if (ch === '"' || ch === "'") {
      const end = scanQuoted(rest, index, ch);
      attrs += span("s", rest.slice(index, end));
      index = end;
      continue;
    }
    const attrName = /^[A-Za-z_:][A-Za-z0-9:._-]*/.exec(rest.slice(index));
    if (attrName !== null) {
      attrs += span("p", attrName[0]);
      index += attrName[0].length;
      continue;
    }
    attrs += Bun.escapeHTML(ch);
    index += 1;
  }
  return `${open}${name}${attrs}`;
};

const highlightMarkupLine = (line: string): string => {
  let out = "";
  let index = 0;
  while (index < line.length) {
    const open = line.indexOf("<", index);
    if (open === -1) {
      out += Bun.escapeHTML(line.slice(index));
      break;
    }
    if (open > index) out += Bun.escapeHTML(line.slice(index, open));
    const isComment = line.startsWith("<!--", open);
    const closeToken = isComment ? "-->" : ">";
    const closeAt = line.indexOf(closeToken, open + (isComment ? 4 : 1));
    const end = closeAt === -1 ? line.length : closeAt + closeToken.length;
    out += highlightMarkupTag(line.slice(open, end));
    index = end;
  }
  return out;
};

export const highlightLine = (line: string, language: string | undefined): string => {
  const family = familyForLanguage(language);
  switch (family) {
    case "code":
    case "json":
    case "shell":
    case "sql":
      return highlightCodeLine(line, family);
    case "yaml":
      return highlightKeyedLine(line, YAML_KEY, ["#"]);
    case "css":
      return highlightKeyedLine(line, CSS_PROP, ["/*", "//"]);
    case "markup":
      return highlightMarkupLine(line);
    case "plain":
      return Bun.escapeHTML(line);
    default: {
      const _exhaustive: never = family;
      return _exhaustive;
    }
  }
};

export const highlightBlock = (code: string, language: string | undefined): string =>
  code
    .split("\n")
    .map((line) => highlightLine(line, language))
    .join("\n");
