import { codeToTokens, isSupportedLanguage, type Theme, type ThemedToken } from "@pierre/highlights";

export type TokenKind = "k" | "s" | "c" | "n" | "t" | "f" | "p";

const SPECTRE_THEME: Theme = {
  name: "Spectre",
  appearance: "dark",
  cssVariables: { prefix: "--" },
  style: {
    "editor.background": "bg",
    "editor.foreground": "fg",
    created: "k",
    deleted: "k",
    modified: "k",
    syntax: {
      attribute: "p",
      background: "bg",
      boolean: "k",
      comment: "c",
      constant: "n",
      constructor: "t",
      "diff.minus": "k",
      "diff.plus": "s",
      embedded: "fg",
      emphasis: "fg",
      enum: "t",
      foreground: "fg",
      function: "f",
      hint: "c",
      keyword: "k",
      "keyword.operator": "fg",
      label: "p",
      link_text: "s",
      link_uri: "k",
      namespace: "t",
      number: "n",
      operator: "fg",
      predictive: "c",
      preproc: "k",
      primary: "f",
      property: "p",
      punctuation: "fg",
      "punctuation.special": "k",
      selector: "k",
      "selector.class": "p",
      "selector.id": "f",
      "selector.pseudo": "k",
      string: "s",
      "string.escape": "n",
      "string.regex": "s",
      "string.special": "n",
      tag: "t",
      "tag.component.jsx": "t",
      text: "fg",
      "text.literal": "s",
      title: "k",
      type: "t",
      variable: "fg",
      "variable.parameter": "fg",
      "variable.special": "k",
      variant: "n",
    },
  },
};

const ALIAS_MAP: Readonly<Record<string, string>> = {
  jsonc: "json",
  jsonl: "json",
  console: "sh",
  shell: "sh",
  zsh: "sh",
  htm: "html",
  svg: "xml",
  sqlite: "sql",
  postgres: "sql",
  postgresql: "sql",
  yml: "yaml",
  env: "ini",
};

export const resolveLanguage = (raw: string | undefined): string => {
  if (raw === undefined) return "text";
  const cleaned = raw.trim().toLowerCase().replace(/^language-/, "").replace(/[^\w#+.-]/g, "");
  if (cleaned === "") return "text";
  const candidate = ALIAS_MAP[cleaned] ?? cleaned;
  return isSupportedLanguage(candidate) ? candidate : "text";
};

export const languageForPath = (filePath: string): string => {
  const slash = filePath.lastIndexOf("/");
  const base = (slash === -1 ? filePath : filePath.slice(slash + 1)).toLowerCase();
  if (base === "dockerfile" || base.startsWith("dockerfile.")) return "dockerfile";
  if (base === "makefile" || base === "justfile") return "makefile";
  if (base.startsWith(".env")) return "ini";
  const dot = base.lastIndexOf(".");
  if (dot === -1 || dot === base.length - 1) return "text";
  return resolveLanguage(base.slice(dot + 1));
};

const KIND_BY_COLOR: Readonly<Record<string, TokenKind>> = {
  "var(--k)": "k",
  "var(--s)": "s",
  "var(--c)": "c",
  "var(--n)": "n",
  "var(--t)": "t",
  "var(--f)": "f",
  "var(--p)": "p",
};

const renderToken = (token: ThemedToken): string => {
  const kind = token.color === undefined ? undefined : KIND_BY_COLOR[token.color];
  if (kind === undefined) return Bun.escapeHTML(token.content);
  const trimmed = token.content.trimEnd();
  if (trimmed === "") return Bun.escapeHTML(token.content);
  const trailing = token.content.slice(trimmed.length);
  return `<span class="hl-${kind}">${Bun.escapeHTML(trimmed)}</span>${Bun.escapeHTML(trailing)}`;
};

const renderTokenLine = (tokens: ReadonlyArray<ThemedToken>): string =>
  tokens.map(renderToken).join("");

export const highlightLines = (
  lines: ReadonlyArray<string>,
  language: string | undefined,
): ReadonlyArray<string> => {
  if (lines.length === 0) return [];
  const lang = resolveLanguage(language);
  if (!isSupportedLanguage(lang)) return lines.map((line) => Bun.escapeHTML(line));
  const result = codeToTokens(lines.join("\n"), { lang, theme: SPECTRE_THEME });
  return lines.map((fallback, index) => {
    const lineTokens = result.tokens[index];
    return lineTokens === undefined ? Bun.escapeHTML(fallback) : renderTokenLine(lineTokens);
  });
};

export const highlightLine = (line: string, language: string | undefined): string =>
  highlightLines([line], language)[0] ?? Bun.escapeHTML(line);

export const highlightBlock = (code: string, language: string | undefined): string =>
  highlightLines(code.split("\n"), language).join("\n");
