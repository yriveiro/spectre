export type TextAsk = {
  readonly pattern: string;
  readonly path?: string;
  readonly include?: string;
  readonly literal?: boolean;
};

export type Health =
  | { readonly kind: "ready"; readonly binary: string; readonly version: string }
  | { readonly kind: "absent"; readonly why: string }
  | { readonly kind: "stale"; readonly binary: string; readonly version: string };

export type Route =
  | { readonly kind: "task"; readonly task: string }
  | { readonly kind: "literal"; readonly text: string }
  | { readonly kind: "regex"; readonly pattern: string };

export type AllowWhy = "plain-text" | "too-broad" | "already-asked" | "no-instrument";
export type Verdict =
  | { readonly kind: "allow"; readonly why: AllowWhy }
  | { readonly kind: "route"; readonly route: Route };

export const PLAIN_EXTENSIONS: readonly string[] = [
  ".log",
  ".md",
  ".mdx",
  ".txt",
  ".csv",
  ".tsv",
  ".jsonl",
  ".lock",
  ".env",
  ".sql",
  ".snap",
];

export const CODE_TOKENS: readonly string[] = [
  "function ",
  "class ",
  "def ",
  "import ",
  "const ",
  "let ",
  "var ",
  "return ",
  "=>",
  "::",
  "->",
  "(",
];

const REGEX_METACHARACTERS: readonly string[] = [
  "\\",
  "^",
  "$",
  "*",
  "+",
  "?",
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
  "|",
];

const hasWhitespace = (pattern: string): boolean => /\s/.test(pattern);

const hasPlainExtension = (value: string): boolean => {
  const lower = value.toLowerCase();
  return PLAIN_EXTENSIONS.some((extension) => lower.endsWith(extension));
};

const hasCodeToken = (pattern: string): boolean =>
  CODE_TOKENS.some((token) => pattern.includes(token));

const hasRegexMetacharacter = (pattern: string): boolean =>
  REGEX_METACHARACTERS.some((meta) => pattern.includes(meta));

export const judge = (
  ask: TextAsk,
  seen: ReadonlySet<string>,
  health: Health,
): Verdict => {
  if (ask.literal === true) {
    return { kind: "allow", why: "plain-text" };
  }
  if (health.kind !== "ready") {
    return { kind: "allow", why: "no-instrument" };
  }
  if (ask.pattern.trim().length < 3) {
    return { kind: "allow", why: "too-broad" };
  }
  if (
    (ask.path !== undefined && hasPlainExtension(ask.path)) ||
    (ask.include !== undefined && hasPlainExtension(ask.include))
  ) {
    return { kind: "allow", why: "plain-text" };
  }
  if (ask.pattern.includes("\n") || ask.pattern.includes("\r")) {
    return { kind: "allow", why: "plain-text" };
  }
  if (seen.has(ask.pattern)) {
    return { kind: "allow", why: "already-asked" };
  }
  if (hasWhitespace(ask.pattern)) {
    if (hasCodeToken(ask.pattern)) {
      return { kind: "route", route: { kind: "task", task: ask.pattern } };
    }
    return { kind: "allow", why: "plain-text" };
  }
  if (!hasRegexMetacharacter(ask.pattern)) {
    return { kind: "route", route: { kind: "literal", text: ask.pattern } };
  }
  return { kind: "route", route: { kind: "regex", pattern: ask.pattern } };
};

export const argv = (route: Route, root: string, budget: number): string[] => {
  switch (route.kind) {
    case "task":
      return [root, `--for=${route.task}`, "--signatures-only", `--token-budget=${budget}`];
    case "literal":
      return [root, `--grep=${route.text}`];
    case "regex":
      return [root, `--regex=${route.pattern}`];
  }
};
