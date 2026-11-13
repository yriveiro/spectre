import { Skill } from "@opencode/plugin/effect";
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
  | { readonly kind: "regex"; readonly pattern: string };

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
  | { readonly kind: "search"; readonly pattern: string; readonly path?: string }
  | { readonly kind: "unmappable" }
  | { readonly kind: "landing"; readonly command: string }
  | {
      readonly kind: "ripwire";
      readonly command: string;
      readonly lookup: boolean;
      readonly delta: boolean;
      readonly affected: boolean;
    }
  | { readonly kind: "other" };

export type Ask =
  | { readonly surface: "prompt" }
  | { readonly surface: "context"; readonly tools: ReadonlyArray<string> }
  | { readonly surface: "text"; readonly id: "grep" | "ripgrep"; readonly ask: TextAsk }
  | { readonly surface: "shell"; readonly command: string; readonly parsed: ShellAsk }
  | { readonly surface: "read"; readonly path: string; readonly code: boolean; readonly insideRoot: boolean }
  | { readonly surface: "mutate"; readonly tool: "edit" | "write"; readonly path: string }
  | { readonly surface: "subagent"; readonly child: string };

/** One arm of `Ask`, so a reader can name the surface it read. */
export type SurfaceAsk<Surface extends Ask["surface"]> = Extract<Ask, { readonly surface: Surface }>;

export type Outcome = "answered" | "empty" | "partial" | "absent" | "refused";

/**
 * What a session holds about one text it asked for: the reroute records the ask,
 * and the answer arrives with its outcome. A pattern with no entry was never asked.
 */
export type Answer = { readonly kind: "pending" } | { readonly kind: "answered"; readonly outcome: Outcome };

export type Why =
  | "no-instrument"
  | "no-skill"
  | "plain-text"
  | "too-broad"
  | "already-asked"
  | "already-attached"
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
  | { readonly kind: "attach"; readonly skill: Skill.ID }
  | {
      readonly kind: "reroute";
      readonly origin: "grep" | "shell";
      readonly input: Record<string, unknown>;
    }
  | { readonly kind: "refuse"; readonly gate: "read" | "land"; readonly message: string }
  | { readonly kind: "prose"; readonly key: "rule" | "end-of-work"; readonly text: string };

export interface Memory {
  readonly attached: boolean;
  readonly subagent: boolean;
  readonly search: boolean;
  readonly touched: number;
  readonly asked: Map<string, Answer>;
  readonly reads: number;
  readonly edited: Set<string>;
  readonly mutation: number;
  readonly measured: { readonly delta?: number; readonly affected?: number };
  readonly spent: Set<"read" | "land">;
  readonly subagents: number;
}

export interface Env {
  readonly health: Health;
  readonly skill: boolean;
  readonly parentID: boolean;
}

export type Decision = { readonly verdict: Verdict; readonly next: Memory };

/** The compact map: the body the first prompt attaches, and the id that attachment names. */
export const MAP: Skill.ID = Skill.ID.make("ripwire-first");

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
 * The flags a bare search may carry. Every one is value-less, so the next token
 * is a pattern or a path. Any other flag is `unmappable`: a flag this reader
 * does not know could consume the next token and move the pattern.
 */
const RG_FLAGS: ReadonlySet<string> = new Set([
  "-n",
  "-i",
  "-S",
  "-w",
  "-l",
  "-L",
  "-c",
  "-v",
  "-s",
  "-h",
  "-H",
  "-o",
  "-q",
  "-F",
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
]);

const GIT_GREP_FLAGS: ReadonlySet<string> = new Set([
  "-n",
  "-i",
  "-I",
  "-l",
  "-L",
  "-w",
  "-c",
  "-v",
  "-h",
  "-H",
  "-F",
  "--line-number",
  "--ignore-case",
  "--word-regexp",
  "--files-with-matches",
  "--files-without-match",
  "--count",
  "--invert-match",
  "--cached",
  "--untracked",
]);

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
    if (char === "|" || char === "&" || char === ";" || char === "<" || char === ">" || char === "`" || char === "\n") {
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

/**
 * Read one bare `rg` or `git grep` into a pattern and at most one path. A
 * composed command, a flag this reader does not know, `-e`, `-f`, or a second
 * path is `unmappable`: the native command runs and answers in the same call.
 */
const parseSearch = (command: string, kind: "rg" | "git"): ShellAsk => {
  const lexed = lex(command);
  if ("broken" in lexed || lexed.composed) return { kind: "unmappable" };
  const flags = kind === "rg" ? RG_FLAGS : GIT_GREP_FLAGS;
  const words = lexed.tokens.slice(kind === "rg" ? 1 : 2);
  const positional: Array<string> = [];
  let pathsOnly = false;
  for (const word of words) {
    if (pathsOnly) {
      positional.push(word);
      continue;
    }
    if (word === "--") {
      pathsOnly = true;
      continue;
    }
    if (word.startsWith("-")) {
      if (!flags.has(word)) return { kind: "unmappable" };
      continue;
    }
    positional.push(word);
  }
  const [pattern, ...paths] = positional;
  if (pattern === undefined || pattern === "") return { kind: "unmappable" };
  if (paths.length > 1) return { kind: "unmappable" };
  const path = paths[0];
  return path === undefined ? { kind: "search", pattern } : { kind: "search", pattern, path };
};

/**
 * Read a shell command into the shapes the rule can act on: a bare search, a
 * ripwire lookup, a landing command, or nothing this reader recognises.
 */
export const shellParse = (command: string): ShellAsk => {
  const words = command.trim().split(/\s+/).filter((word) => word !== "");
  const head = words[0] ?? "";
  const name = head.slice(head.lastIndexOf("/") + 1);
  if (name === "ripwire") {
    return {
      kind: "ripwire",
      command,
      lookup: !words.some((word) => word === "--help" || word === "--version"),
      delta: hasFlag(words, "--quality-delta"),
      affected: hasFlag(words, "--affected"),
    };
  }
  if (LANDING.some((prefix) => startsWith(words, prefix))) return { kind: "landing", command };
  if (name === "rg") return parseSearch(command, "rg");
  if (name === "git" && isGitGrep(command)) return parseSearch(command, "git");
  return { kind: "other" };
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

/** The rule the context part carries. A session with no instrument is told so on every request. */
export const contextRule = (health: Health): string =>
  health.kind === "ready" ? CONTRACT.rule : `${CONTRACT.rule}\n\n${NATIVE}`;

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
  }
};

const onPrompt = (memory: Memory, env: Env): Decision => {
  const next: Memory = { ...memory, subagent: env.parentID };
  if (!memory.attached && env.skill) {
    return { verdict: { kind: "attach", skill: MAP }, next: { ...next, attached: true } };
  }
  if (memory.attached) return passed("already-attached", next);
  return passed("no-skill", next);
};

const measuredFresh = (memory: Memory): boolean => {
  const { delta, affected } = memory.measured;
  return delta !== undefined && affected !== undefined && delta >= memory.mutation && affected >= memory.mutation;
};

/** The context part: the rule alone, with the end-of-work nudge while an edit is unmeasured. */
const contextProse = (memory: Memory, health: Health): Extract<Verdict, { readonly kind: "prose" }> => {
  const rule = contextRule(health);
  if (memory.mutation === 0 || measuredFresh(memory)) return { kind: "prose", key: "rule", text: rule };
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

const onShellSearch = (parsed: Extract<ShellAsk, { readonly kind: "search" }>, memory: Memory): Decision => {
  const route = patternRoute(parsed.pattern);
  const input: Record<string, unknown> = {
    pattern: parsed.pattern,
    ...(parsed.path === undefined ? {} : { path: parsed.path }),
    ...(route.kind === "regex" ? { kind: "regex" } : {}),
  };
  return { verdict: { kind: "reroute", origin: "shell", input }, next: memory };
};

const onLanding = (memory: Memory): Decision => {
  if (memory.mutation === 0) return passed("nothing-edited", memory);
  if (memory.spent.has("land")) return passed("gate-spent", memory);
  if (measuredFresh(memory)) return passed("measured", memory);
  const spent = new Set(memory.spent);
  spent.add("land");
  return {
    verdict: { kind: "refuse", gate: "land", message: landRefusal([...memory.edited]) },
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
    case "ripwire": {
      if (!parsed.lookup) return passed("not-a-search", memory);
      const measured = {
        ...memory.measured,
        ...(parsed.delta ? { delta: memory.mutation } : {}),
        ...(parsed.affected ? { affected: memory.mutation } : {}),
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
  const edited = new Set(memory.edited);
  edited.add(ask.path);
  return {
    verdict: { kind: "pass", why: "not-a-gate" },
    next: { ...memory, edited, mutation: memory.mutation + 1 },
  };
};

const onSubagent = (memory: Memory): Decision => ({
  verdict: { kind: "pass", why: "not-a-gate" },
  next: { ...memory, subagents: memory.subagents + 1 },
});

/**
 * The rule, first match wins. Absent or stale ripwire passes every gate as
 * `no-instrument`; discovery and the prose rule do not depend on the instrument,
 * so they run first. The read refusal and the landing refusal each spend once,
 * and the second call is native.
 */
export const decide = (ask: Ask, memory: Memory, env: Env): Decision => {
  if (ask.surface === "prompt") return onPrompt(memory, env);
  if (ask.surface === "context") return onContext(ask.tools, memory, env.health);
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
  }
};

export type ArgvInput = {
  readonly route: Route;
  readonly root: string;
  readonly budget: number;
};

export const argv = ({ route, root, budget }: ArgvInput): string[] => {
  switch (route.kind) {
    case "task":
      return [root, `--for=${route.task}`, "--signatures-only", `--token-budget=${budget}`];
    case "literal":
      return [root, `--grep=${route.text}`];
    case "regex":
      return [root, `--regex=${route.pattern}`];
  }
};
