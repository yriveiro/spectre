import { Skill } from "@opencode/plugin/effect";
import { CONTRACT } from "./contract";

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

export type ShellAsk =
  | { readonly kind: "search"; readonly pattern: string; readonly path?: string; readonly include?: string }
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
 * Read a shell command into the shapes the rule can act on: a ripwire lookup, a
 * landing command, or nothing this reader recognises.
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
  return { kind: "other" };
};

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

const onContext = (tools: ReadonlyArray<string>, memory: Memory, health: Health): Decision => ({
  verdict: { kind: "prose", key: "rule", text: contextRule(health) },
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

const onShell = (parsed: ShellAsk, memory: Memory): Decision => {
  switch (parsed.kind) {
    case "other":
      return passed("not-a-search", memory);
    case "search":
      return passed("unmappable", memory);
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
    case "landing": {
      if (memory.mutation === 0) return passed("nothing-edited", memory);
      if (memory.spent.has("land")) return passed("gate-spent", memory);
      const { delta, affected } = memory.measured;
      const fresh =
        delta !== undefined && affected !== undefined && delta >= memory.mutation && affected >= memory.mutation;
      if (fresh) return passed("measured", memory);
      return passed("not-a-gate", memory);
    }
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
  return passed("not-a-gate", memory);
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
 * so they run first. The read refusal and the landing refusal are not written
 * yet: until they are, the row below each passes as `not-a-gate`.
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
