import { CONTRACT, END_OF_WORK, landRefusal, readRefusal } from "./contract";

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
  | { readonly kind: "regex"; readonly pattern: string }
  | { readonly kind: "expand"; readonly symbol: string };

export type AllowWhy = "plain-text" | "too-broad" | "already-asked" | "no-instrument";
export type JudgeVerdict =
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

/** True for a path the text tool is the right instrument for: a log, a doc, a fixture. */
export const hasPlainExtension = (value: string): boolean => {
  const lower = value.toLowerCase();
  return PLAIN_EXTENSIONS.some((extension) => lower.endsWith(extension));
};

const hasCodeToken = (pattern: string): boolean =>
  CODE_TOKENS.some((token) => pattern.includes(token));

const hasRegexMetacharacter = (pattern: string): boolean =>
  REGEX_METACHARACTERS.some((meta) => pattern.includes(meta));

type PhraseRoute = Route | { readonly kind: "plain" };

/**
 * A pattern that holds a space is prose unless a code token or a regex
 * metacharacter says otherwise. `undefined` means it does not hold a space.
 */
const phraseRoute = (pattern: string): PhraseRoute | undefined => {
  if (!hasWhitespace(pattern)) return undefined;
  if (hasCodeToken(pattern)) return { kind: "task", task: pattern };
  if (hasRegexMetacharacter(pattern)) return { kind: "regex", pattern };
  return { kind: "plain" };
};

export type JudgeInput = {
  readonly ask: TextAsk;
  readonly seen: ReadonlySet<string>;
  readonly health: Health;
};

/** The text-surface rows. Every verdict here is a `pass` or a `reroute` in `decide`. */
export const judge = ({ ask, seen, health }: JudgeInput): JudgeVerdict => {
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
  const phrase = phraseRoute(ask.pattern);
  if (phrase !== undefined) {
    if (phrase.kind === "plain") return { kind: "allow", why: "plain-text" };
    return { kind: "route", route: phrase };
  }
  if (!hasRegexMetacharacter(ask.pattern)) {
    return { kind: "route", route: { kind: "literal", text: ask.pattern } };
  }
  return { kind: "route", route: { kind: "regex", pattern: ask.pattern } };
};

export type ShellAsk =
  | {
      readonly kind: "search";
      readonly pattern: string;
      readonly path?: string;
      readonly include?: string;
      readonly literal?: boolean;
    }
  | { readonly kind: "unmappable" }
  | { readonly kind: "landing"; readonly command: string }
  | { readonly kind: "destructive"; readonly command: string }
  | {
      readonly kind: "ripwire";
      readonly command: string;
      readonly lookup: boolean;
      readonly delta: boolean;
      readonly affected: boolean;
      readonly fanout: boolean;
    }
  | { readonly kind: "other" };

export type Ask =
  | { readonly surface: "context"; readonly tools: ReadonlyArray<string> }
  | { readonly surface: "text"; readonly id: "grep" | "ripgrep"; readonly ask: TextAsk }
  | { readonly surface: "shell"; readonly command: string; readonly parsed: ShellAsk }
  | {
      readonly surface: "read";
      readonly path: string;
      readonly code: boolean;
      readonly insideRoot: boolean;
    }
  | {
      readonly surface: "mutate";
      readonly tool: "edit" | "write";
      readonly path: string;
      readonly code: boolean;
      readonly insideRoot?: boolean;
    }
  | { readonly surface: "subagent"; readonly child: string; readonly agent?: string }
  | { readonly surface: "complete"; readonly text: string; readonly outcome: Outcome };

/** One arm of `Ask`, so a reader can name the surface it read. */
export type SurfaceAsk<Surface extends Ask["surface"]> = Extract<
  Ask,
  { readonly surface: Surface }
>;

export type Outcome = "answered" | "empty" | "partial" | "absent" | "refused";

/**
 * What a session holds about one text it asked for: the reroute records the ask,
 * and the answer arrives with its outcome. A pattern with no entry was never asked.
 */
export type Answer =
  | { readonly kind: "pending" }
  | { readonly kind: "answered"; readonly outcome: Outcome };

export type Why =
  | "no-instrument"
  | "plain-text"
  | "too-broad"
  | "already-asked"
  | "search-unavailable"
  | "unmappable"
  | "not-a-search"
  | "nothing-edited"
  | "measured"
  | "gate-spent"
  | "not-code"
  | "outside-root"
  | "already-used"
  | "already-read"
  | "already-edit"
  | "not-a-gate";

export type Verdict =
  | { readonly kind: "pass"; readonly why: Why }
  | {
      readonly kind: "reroute";
      readonly origin: "grep" | "shell";
      readonly input: Record<string, unknown>;
    }
  | {
      readonly kind: "refuse";
      readonly gate: "read" | "land" | "spectre";
      readonly message: string;
    }
  | { readonly kind: "prose"; readonly key: "rule" | "end-of-work"; readonly text: string };

export interface Memory {
  readonly search: boolean;
  readonly touched: number;
  readonly asked: Map<string, Answer>;
  readonly reads: number;
  readonly edited: Set<string>;
  readonly editedCode: Set<string>;
  readonly mutation: number;
  readonly codeMutation?: number;
  readonly measured: { readonly delta?: number; readonly affected?: number };
  readonly spent: Set<"read" | "land">;
  readonly subagents: number;
}

export interface Env {
  readonly health: Health;
}

export type Decision = { readonly verdict: Verdict; readonly next: Memory };

const LANDING: ReadonlyArray<ReadonlyArray<string>> = [
  ["git", "commit"],
  ["git", "push"],
  ["git", "merge"],
  ["git", "rebase", "--continue"],
  ["gh", "pr", "create"],
];

const hasFlag = (words: ReadonlyArray<string>, flag: string): boolean =>
  words.some((word) => word === flag || word.startsWith(`${flag}=`));

const startsWith = (words: ReadonlyArray<string>, prefix: ReadonlyArray<string>): boolean =>
  prefix.every((word, index) => words[index] === word);

/**
 * The flags a bare search may carry. The short sets are characters, so a
 * combined token such as `-rn` reads as `-r -n`. A flag outside the set is
 * `unmappable`: a flag this reader does not know could consume the next token
 * and move the pattern.
 */
interface SearchFlags {
  readonly long: ReadonlySet<string>;
  readonly short: ReadonlySet<string>;
}

const RG_FLAGS: SearchFlags = {
  long: new Set([
    "--line-number",
    "--no-line-number",
    "--column",
    "--no-column",
    "--ignore-case",
    "--case-sensitive",
    "--smart-case",
    "--word-regexp",
    "--files-with-matches",
    "--files-without-match",
    "--count",
    "--count-matches",
    "--invert-match",
    "--hidden",
    "--no-ignore",
    "--no-messages",
    "--no-heading",
    "--fixed-strings",
    "--literal",
  ]),
  short: new Set(["n", "i", "S", "w", "l", "L", "c", "v", "s", "h", "H", "o", "q", "F"]),
};

const GIT_GREP_FLAGS: SearchFlags = {
  long: new Set([
    "--line-number",
    "--ignore-case",
    "--word-regexp",
    "--files-with-matches",
    "--files-without-match",
    "--count",
    "--invert-match",
    "--cached",
    "--untracked",
    "--fixed-strings",
  ]),
  short: new Set(["n", "i", "I", "l", "L", "w", "c", "v", "h", "H", "F"]),
};

const GREP_FLAGS: SearchFlags = {
  long: new Set([
    "--line-number",
    "--recursive",
    "--extended-regexp",
    "--fixed-strings",
    "--ignore-case",
    "--word-regexp",
    "--files-with-matches",
    "--files-without-match",
    "--count",
    "--invert-match",
    "--no-messages",
  ]),
  short: new Set([
    "r",
    "R",
    "n",
    "E",
    "F",
    "i",
    "w",
    "I",
    "l",
    "L",
    "c",
    "v",
    "h",
    "H",
    "o",
    "s",
    "q",
  ]),
};

const FIXED_LONG: ReadonlySet<string> = new Set(["--fixed-strings", "--literal"]);

type Lexed =
  | { readonly tokens: ReadonlyArray<string>; readonly composed: boolean }
  | { readonly broken: true };

/**
 * Split a command the way a shell would for the shapes this reader accepts.
 * Quotes hold a space and hide a metacharacter, a backslash escapes the next
 * character, and an unquoted `|`, `&`, `;`, `<`, `>`, `$(`, backtick or newline
 * marks the command as composed. An unbalanced quote is `broken`.
 */
const lex = (command: string): Lexed => {
  const tokens: Array<string> = [];
  let current = "";
  let started = false;
  let quote: '"' | "'" | undefined;
  let composed = false;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index] ?? "";
    if (quote !== undefined) {
      if (char === quote) {
        quote = undefined;
        continue;
      }
      if (char === "\\" && quote === '"' && index + 1 < command.length) {
        current += command[index + 1] ?? "";
        index += 1;
        started = true;
        continue;
      }
      current += char;
      started = true;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      started = true;
      continue;
    }
    if (char === "\\" && index + 1 < command.length) {
      current += command[index + 1] ?? "";
      index += 1;
      started = true;
      continue;
    }
    if ("|&;<>`\n".includes(char)) {
      composed = true;
      continue;
    }
    if (char === "$" && command[index + 1] === "(") {
      composed = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (started) {
        tokens.push(current);
        current = "";
        started = false;
      }
      continue;
    }
    current += char;
    started = true;
  }
  if (quote !== undefined) return { broken: true };
  if (started) tokens.push(current);
  return { tokens, composed };
};

const isGitGrep = (command: string): boolean => /^\s*git\s+grep(?:\s|$)/.test(command);

/** One token's flag meaning, or `undefined` when the token is a pattern or a path. */
const readFlag = (
  word: string,
  flags: SearchFlags,
): { readonly fixed: boolean; readonly recursive: boolean } | "unmappable" | undefined => {
  if (word.startsWith("--")) {
    if (!flags.long.has(word)) return "unmappable";
    return { fixed: FIXED_LONG.has(word), recursive: word === "--recursive" };
  }
  if (word.startsWith("-") && word.length > 1) {
    const chars = word.slice(1);
    for (const char of chars) {
      if (!flags.short.has(char)) return "unmappable";
    }
    return { fixed: chars.includes("F"), recursive: chars.includes("r") || chars.includes("R") };
  }
  return undefined;
};

interface SearchWords {
  readonly positional: ReadonlyArray<string>;
  readonly include?: string;
  readonly literal: boolean;
  readonly recursive: boolean;
}

const scanWords = (
  words: ReadonlyArray<string>,
  flags: SearchFlags,
  kind: "rg" | "git" | "grep",
): SearchWords | undefined => {
  const positional: Array<string> = [];
  let pathsOnly = false;
  let include: string | undefined;
  let literal = false;
  let recursive = false;
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index] ?? "";
    if (pathsOnly) {
      positional.push(word);
      continue;
    }
    if (word === "--") {
      pathsOnly = true;
      continue;
    }
    if (kind === "grep" && word.startsWith("--include=")) {
      include = word.slice("--include=".length);
      continue;
    }
    if (kind === "grep" && word === "--include") {
      const value = words[index + 1];
      if (value === undefined) return undefined;
      include = value;
      index += 1;
      continue;
    }
    const flag = readFlag(word, flags);
    if (flag === "unmappable") return undefined;
    if (flag !== undefined) {
      if (flag.fixed) literal = true;
      if (flag.recursive) recursive = true;
      continue;
    }
    positional.push(word);
  }
  return {
    positional,
    ...(include === undefined ? {} : { include }),
    literal,
    recursive,
  };
};

export const SPECTRE_DELETE_REFUSAL =
  "Refusing recursive deletion of `.spectre`: `.spectre/brain` is git-tracked institutional memory and must not be deleted. Remove only specific scratch files if needed.";

const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const WRAPPERS: ReadonlySet<string> = new Set(["env", "command", "sudo"]);
const GIT_VALUE_FLAGS: ReadonlySet<string> = new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--config-env",
]);

const baseName = (word: string): string => word.slice(word.lastIndexOf("/") + 1);

const operatorLength = (command: string, index: number): number => {
  const pair = command.slice(index, index + 2);
  if (pair === "&&" || pair === "||") return 2;
  const char = command[index] ?? "";
  return char === ";" || char === "|" || char === "\n" ? 1 : 0;
};

const advanceQuoted = (
  command: string,
  index: number,
  quote: '"' | "'",
): { readonly next: number; readonly closed: boolean } => {
  const char = command[index] ?? "";
  if (char === quote) return { next: index + 1, closed: true };
  if (char === "\\" && quote === '"' && index + 1 < command.length) {
    return { next: index + 2, closed: false };
  }
  return { next: index + 1, closed: false };
};

const splitSegments = (command: string): ReadonlyArray<string> | undefined => {
  const segments: Array<string> = [];
  let start = 0;
  let index = 0;
  let quote: '"' | "'" | undefined;
  while (index < command.length) {
    if (quote !== undefined) {
      const step = advanceQuoted(command, index, quote);
      if (step.closed) quote = undefined;
      index = step.next;
      continue;
    }
    const char = command[index] ?? "";
    if (char === "'" || char === '"') {
      quote = char;
      index += 1;
      continue;
    }
    if (char === "\\" && index + 1 < command.length) {
      index += 2;
      continue;
    }
    const op = operatorLength(command, index);
    if (op > 0) {
      segments.push(command.slice(start, index));
      index += op;
      start = index;
      continue;
    }
    index += 1;
  }
  if (quote !== undefined) return undefined;
  segments.push(command.slice(start));
  return segments;
};

const stripLeadingEnv = (tokens: ReadonlyArray<string>): ReadonlyArray<string> => {
  const first = tokens.findIndex(
    (word) => !ENV_ASSIGNMENT.test(word) && !WRAPPERS.has(baseName(word)),
  );
  return first < 0 ? [] : tokens.slice(first);
};

const gitWords = (words: ReadonlyArray<string>): ReadonlyArray<string> => {
  let index = 1;
  while (index < words.length) {
    const word = words[index] ?? "";
    if (GIT_VALUE_FLAGS.has(word)) {
      index += 2;
      continue;
    }
    if (word.startsWith("-")) {
      index += 1;
      continue;
    }
    break;
  }
  return ["git", ...words.slice(index)];
};

const isSpectreTarget = (raw: string): boolean => {
  let clean = raw.replace(/\/+/g, "/");
  while (clean.startsWith("./")) clean = clean.slice(2);
  while (clean.length > 1 && clean.endsWith("/")) clean = clean.slice(0, -1);
  if (clean === ".spectre" || clean.endsWith("/.spectre")) return true;
  if (clean === ".spectre/*" || clean.endsWith("/.spectre/*")) return true;
  return (
    clean === ".spectre/brain" ||
    clean.endsWith("/.spectre/brain") ||
    clean.startsWith(".spectre/brain/") ||
    clean.includes("/.spectre/brain/")
  );
};

const isRecursiveRmFlag = (word: string): boolean =>
  word === "--recursive" ||
  (word.startsWith("-") && !word.startsWith("--") && (word.includes("r") || word.includes("R")));

const isSpectreDelete = (words: ReadonlyArray<string>): boolean => {
  if (baseName(words[0] ?? "") !== "rm") return false;
  let recursive = false;
  let flagsDone = false;
  const targets: Array<string> = [];
  for (const word of words.slice(1)) {
    if (!flagsDone && word === "--") {
      flagsDone = true;
      continue;
    }
    if (!flagsDone && word.startsWith("-") && word.length > 1) {
      if (isRecursiveRmFlag(word)) recursive = true;
      continue;
    }
    targets.push(word);
  }
  return recursive && targets.some(isSpectreTarget);
};

const parseSearchTokens = (
  args: ReadonlyArray<string>,
  composed: boolean,
  kind: "rg" | "git" | "grep",
): ShellAsk => {
  if (composed) return { kind: "unmappable" };
  const flags = kind === "rg" ? RG_FLAGS : kind === "git" ? GIT_GREP_FLAGS : GREP_FLAGS;
  const scanned = scanWords(args, flags, kind);
  if (scanned === undefined) return { kind: "unmappable" };
  const [pattern, ...paths] = scanned.positional;
  if (pattern === undefined || pattern === "" || paths.length > 1) return { kind: "unmappable" };
  if (kind === "grep" && paths.length === 0 && !scanned.recursive) return { kind: "unmappable" };
  const path = paths[0];
  return {
    kind: "search",
    pattern,
    ...(path === undefined ? {} : { path }),
    ...(scanned.include === undefined ? {} : { include: scanned.include }),
    ...(scanned.literal ? { literal: true } : {}),
  };
};

const searchKindOf = (
  name: string,
  second: string | undefined,
): "rg" | "grep" | "git" | undefined => {
  if (name === "rg" || name === "ripgrep") return "rg";
  if (name === "grep") return "grep";
  if (name === "git" && second === "grep") return "git";
  return undefined;
};

const classifySegment = (segment: string, command: string, single: boolean): ShellAsk => {
  const lexed = lex(segment);
  if ("broken" in lexed) return { kind: "unmappable" };
  const words = stripLeadingEnv(lexed.tokens);
  const name = baseName(words[0] ?? "");
  if (name === "") return { kind: "other" };
  if (isSpectreDelete(words)) return { kind: "destructive", command };
  const canonical = name === "git" ? gitWords(words) : [name, ...words.slice(1)];
  if (LANDING.some((prefix) => startsWith(canonical, prefix))) return { kind: "landing", command };
  if (name === "ripwire") {
    return {
      kind: "ripwire",
      command,
      lookup: !words.some((word) => word === "--help" || word === "--version"),
      delta: hasFlag(words, "--quality-delta"),
      affected: hasFlag(words, "--affected"),
      fanout: hasFlag(words, "--pack-task") || hasFlag(words, "--partition"),
    };
  }
  const searchKind = searchKindOf(name, canonical[1]);
  if (searchKind === undefined) return { kind: "other" };
  if (
    !single ||
    words.length !== lexed.tokens.length ||
    (searchKind === "git" && words[1] !== "grep")
  ) {
    return { kind: "unmappable" };
  }
  return parseSearchTokens(words.slice(searchKind === "git" ? 2 : 1), lexed.composed, searchKind);
};

const mergeRipwireSegments = (
  command: string,
  items: ReadonlyArray<Extract<ShellAsk, { readonly kind: "ripwire" }>>,
): ShellAsk => ({
  kind: "ripwire",
  command,
  lookup: items.some((one) => one.lookup),
  delta: items.some((one) => one.delta),
  affected: items.some((one) => one.affected),
  fanout: items.some((one) => one.fanout),
});

export const shellParse = (command: string): ShellAsk => {
  const segments = splitSegments(command);
  if (segments === undefined) {
    const rawHead = baseName(command.trim().split(/\s+/)[0] ?? "");
    return searchKindOf(rawHead, isGitGrep(command) ? "grep" : undefined) !== undefined
      ? { kind: "unmappable" }
      : { kind: "other" };
  }
  const single = segments.length === 1;
  const classified = segments.map((segment) => classifySegment(segment, command, single));
  const destructive = classified.find((one) => one.kind === "destructive");
  if (destructive !== undefined) return destructive;
  const landing = classified.find((one) => one.kind === "landing");
  if (landing !== undefined) return landing;
  const ripwires = classified.filter(
    (one): one is Extract<ShellAsk, { readonly kind: "ripwire" }> => one.kind === "ripwire",
  );
  if (ripwires.length > 0) return mergeRipwireSegments(command, ripwires);
  if (single) return classified[0] ?? { kind: "other" };
  return classified.some((one) => one.kind === "search" || one.kind === "unmappable")
    ? { kind: "unmappable" }
    : { kind: "other" };
};

/** A pattern's route. The shell reader and the text reader agree on what a metacharacter means. */
export const patternRoute = (pattern: string): Route =>
  hasRegexMetacharacter(pattern) ? { kind: "regex", pattern } : { kind: "literal", text: pattern };

const passed = (why: Why, memory: Memory): Decision => ({
  verdict: { kind: "pass", why },
  next: memory,
});

/** The half the rule cannot say: with no instrument every gate passes and the native tools run. */
const NATIVE =
  "ripwire is not on PATH, so this session is native: `spectre_search` answers `absent` with the install line, and the native tools complete the task.";

const MOMENTS = [
  "- Task / symbol / call-site lookup: `spectre_search({ query })` returns a paged answer-first bundle with `<act read=\"path:l-e,...\"/>` for parallel ranged Reads; backticked symbol questions (`who calls \\`sym\\``, `where is \\`sym\\` used`) auto-route to callers/uses/impact; `name@lang` disambiguates multi-language repos.",
  "- New symbol: `ripwire . --exemplar=<task>` or `--lego=<iface>`.",
  "- Contract edit: `ripwire . --impact=<sym> --uses=<sym>`, then `--edit-check=<file:sym>`.",
  "- Subagent fan-out: `ripwire . --pack-task=<task> --partition=<n>`.",
  "- Branch cleanup: `ripwire . --stray-content` before `--plan`.",
  '- Before commit/PR: call `tools.spectre.ripwire({ action: "check" })` in `execute` (pass `range: "main..HEAD"` for whole-branch delta, or run `ripwire . --quality-delta` and `ripwire . --affected=<paths>`).',
].join("\n");

/** The rule the context part carries. Ready sessions carry the moment cues; native sessions carry the fallback note. */
export const contextRule = (health: Health): string =>
  health.kind === "ready" ? `${CONTRACT.rule}\n\n${MOMENTS}` : `${CONTRACT.rule}\n\n${NATIVE}`;

/**
 * Carry the verdict's route into the renamed call. The search tool re-derives
 * its route from the payload, which carries no `kind`, so without this every
 * reroute would run `--grep`: a task verdict sets `query`, a regex verdict
 * sets `kind: "regex"`, and a literal verdict leaves the input alone.
 */
export const rerouteInput = (input: TextAsk, route: Route): Record<string, unknown> => {
  switch (route.kind) {
    case "task":
      return { ...input, query: route.task };
    case "regex":
      return { ...input, kind: "regex" };
    case "literal":
      return { ...input };
    case "expand":
      return { ...input, expand: route.symbol };
  }
};

export const codeMutationOf = (memory: Memory): number =>
  Math.max(memory.codeMutation ?? 0, memory.editedCode.size);

const measuredFresh = (memory: Memory): boolean => {
  const { delta, affected } = memory.measured;
  const code = codeMutationOf(memory);
  return delta !== undefined && affected !== undefined && delta >= code && affected >= code;
};

/** The context part: the rule alone, with the end-of-work nudge while a code edit is unmeasured. */
const contextProse = (
  memory: Memory,
  health: Health,
): Extract<Verdict, { readonly kind: "prose" }> => {
  const rule = contextRule(health);
  if (memory.editedCode.size === 0 || measuredFresh(memory))
    return { kind: "prose", key: "rule", text: rule };
  return { kind: "prose", key: "end-of-work", text: `${END_OF_WORK}\n\n${rule}` };
};

const onContext = (tools: ReadonlyArray<string>, memory: Memory, health: Health): Decision => ({
  verdict: contextProse(memory, health),
  next: { ...memory, search: tools.includes("spectre_search") },
});

const onText = (ask: TextAsk, memory: Memory, health: Health): Decision => {
  const verdict = judge({ ask, seen: new Set(memory.asked.keys()), health });
  if (verdict.kind === "allow") return passed(verdict.why, memory);
  if (!memory.search) return passed("search-unavailable", memory);
  const asked = new Map(memory.asked);
  asked.set(ask.pattern, { kind: "pending" });
  return {
    verdict: { kind: "reroute", origin: "grep", input: rerouteInput(ask, verdict.route) },
    next: { ...memory, asked },
  };
};

const onShellSearch = (
  parsed: Extract<ShellAsk, { readonly kind: "search" }>,
  memory: Memory,
): Decision => {
  if (parsed.pattern.trim().length < 3) return passed("too-broad", memory);
  if (
    (parsed.path !== undefined && hasPlainExtension(parsed.path)) ||
    (parsed.include !== undefined && hasPlainExtension(parsed.include)) ||
    hasPlainExtension(parsed.pattern)
  ) {
    return passed("plain-text", memory);
  }
  if (parsed.pattern.includes("\n") || parsed.pattern.includes("\r"))
    return passed("plain-text", memory);
  if (memory.asked.has(parsed.pattern)) return passed("already-asked", memory);
  if (!memory.search) return passed("search-unavailable", memory);
  const route =
    parsed.literal === true
      ? { kind: "literal", text: parsed.pattern }
      : patternRoute(parsed.pattern);
  const input: Record<string, unknown> = {
    pattern: parsed.pattern,
    ...(parsed.path === undefined ? {} : { path: parsed.path }),
    ...(parsed.include === undefined ? {} : { include: parsed.include }),
    ...(route.kind === "regex" ? { kind: "regex" } : {}),
  };
  const asked = new Map(memory.asked);
  asked.set(parsed.pattern, { kind: "pending" });
  return { verdict: { kind: "reroute", origin: "shell", input }, next: { ...memory, asked } };
};

const onLanding = (memory: Memory): Decision => {
  if (memory.editedCode.size === 0) return passed("nothing-edited", memory);
  if (memory.spent.has("land")) return passed("gate-spent", memory);
  if (measuredFresh(memory)) return passed("measured", memory);
  const spent = new Set(memory.spent);
  spent.add("land");
  return {
    verdict: { kind: "refuse", gate: "land", message: landRefusal([...memory.editedCode]) },
    next: { ...memory, spent },
  };
};

const onShell = (parsed: ShellAsk, memory: Memory): Decision => {
  switch (parsed.kind) {
    case "other":
      return passed("not-a-search", memory);
    case "unmappable":
      return passed("unmappable", memory);
    case "search":
      return onShellSearch(parsed, memory);
    case "destructive":
      return {
        verdict: { kind: "refuse", gate: "spectre", message: SPECTRE_DELETE_REFUSAL },
        next: memory,
      };
    case "ripwire": {
      if (!parsed.lookup) return passed("not-a-search", memory);
      const code = codeMutationOf(memory);
      const measured = {
        ...memory.measured,
        ...(parsed.delta ? { delta: code } : {}),
        ...(parsed.affected ? { affected: code } : {}),
      };
      return {
        verdict: { kind: "pass", why: "not-a-search" },
        next: { ...memory, touched: memory.touched + 1, measured },
      };
    }
    case "landing":
      return onLanding(memory);
  }
};

const onRead = (ask: SurfaceAsk<"read">, memory: Memory): Decision => {
  if (!ask.code) return passed("not-code", memory);
  if (!ask.insideRoot) return passed("outside-root", memory);
  const counted: Memory = { ...memory, reads: memory.reads + 1 };
  if (memory.touched > 0) return passed("already-used", counted);
  if (memory.reads > 0) return passed("already-read", counted);
  if (memory.edited.has(ask.path)) return passed("already-edit", counted);
  if (memory.spent.has("read")) return passed("gate-spent", counted);
  const spent = new Set(memory.spent);
  spent.add("read");
  return {
    verdict: { kind: "refuse", gate: "read", message: readRefusal(ask.path) },
    next: { ...memory, spent },
  };
};

const onMutate = (ask: SurfaceAsk<"mutate">, memory: Memory): Decision => {
  if (ask.insideRoot === false) return passed("outside-root", memory);
  const edited = new Set(memory.edited);
  edited.add(ask.path);
  const editedCode = new Set(memory.editedCode);
  if (ask.code) editedCode.add(ask.path);
  const codeMutation = ask.code ? codeMutationOf(memory) + 1 : codeMutationOf(memory);
  return {
    verdict: { kind: "pass", why: "not-a-gate" },
    next: { ...memory, edited, editedCode, mutation: memory.mutation + 1, codeMutation },
  };
};

const onSubagent = (memory: Memory): Decision => ({
  verdict: { kind: "pass", why: "not-a-gate" },
  next: { ...memory, subagents: memory.subagents + 1 },
});

const onComplete = (ask: SurfaceAsk<"complete">, memory: Memory): Decision => {
  const asked = new Map(memory.asked);
  if (ask.text !== "") asked.set(ask.text, { kind: "answered", outcome: ask.outcome });
  return {
    verdict: { kind: "pass", why: "not-a-gate" },
    next: { ...memory, touched: memory.touched + 1, asked },
  };
};

/**
 * The rule, first match wins. Absent or stale ripwire passes every gate as
 * `no-instrument`; the prose rule reports native or ready health, so it runs
 * first. The read refusal and the landing refusal each spend once, and the
 * second call is native. The completion row records a search that ran, which
 * is what makes the first code read after it `already-used`.
 */
export const decide = (ask: Ask, memory: Memory, env: Env): Decision => {
  if (ask.surface === "context") return onContext(ask.tools, memory, env.health);
  if (ask.surface === "shell" && ask.parsed.kind === "destructive") {
    return {
      verdict: { kind: "refuse", gate: "spectre", message: SPECTRE_DELETE_REFUSAL },
      next: memory,
    };
  }
  if (env.health.kind !== "ready") return passed("no-instrument", memory);
  switch (ask.surface) {
    case "text":
      return onText(ask.ask, memory, env.health);
    case "shell":
      return onShell(ask.parsed, memory);
    case "read":
      return onRead(ask, memory);
    case "mutate":
      return onMutate(ask, memory);
    case "subagent":
      return onSubagent(memory);
    case "complete":
      return onComplete(ask, memory);
  }
};

export type ArgvInput = {
  readonly route: Route;
  readonly root: string;
  readonly budget?: number;
  readonly page?: number;
  readonly legendSeen?: string;
};

const withLegendSeen = (args: string[], legendSeen?: string): string[] =>
  legendSeen === undefined || legendSeen === "" ? args : [...args, `--legend-seen=${legendSeen}`];

export const argv = ({ route, root, budget, page, legendSeen }: ArgvInput): string[] => {
  switch (route.kind) {
    case "task": {
      const args = [root, `--for=${route.task}`];
      if (budget !== undefined) {
        args.push(`--token-budget=${budget}`);
      } else if (page !== undefined && page > 1) {
        args.push(`--page-bytes=12000:${Math.floor(page)}`);
      }
      return withLegendSeen(args, legendSeen);
    }
    case "expand":
      return withLegendSeen([root, `--expand=${route.symbol}`], legendSeen);
    case "literal":
      return withLegendSeen([root, `--grep=${route.text}`, "--limit=50"], legendSeen);
    case "regex":
      return withLegendSeen([root, `--regex=${route.pattern}`, "--limit=50"], legendSeen);
  }
};
