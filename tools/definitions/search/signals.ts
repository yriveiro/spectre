import { Option, Schema } from "effect";
import { hasPlainExtension, shellParse, type SurfaceAsk } from "./policy";
import { scope } from "./run";

/**
 * The host surfaces, read into an `Ask`. Every reader is pure: it takes the
 * payload the host hands a hook and returns the ask, or `undefined` when the
 * payload is not that surface. Nothing here probes, stores or names a session.
 */

/** The code languages `ripwire --help` lists. A read of one is a read the index answers better. */
const CODE_EXTENSIONS: readonly string[] = [
  ".astro",
  ".bash",
  ".bb",
  ".c",
  ".cc",
  ".clj",
  ".cljc",
  ".cljs",
  ".cpp",
  ".cs",
  ".cts",
  ".cu",
  ".cuh",
  ".dart",
  ".ex",
  ".exs",
  ".go",
  ".gd",
  ".h",
  ".hpp",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".lua",
  ".m",
  ".metal",
  ".mm",
  ".mts",
  ".php",
  ".py",
  ".rb",
  ".rs",
  ".sh",
  ".swift",
  ".ts",
  ".tsx",
];

const extensionOf = (path: string): string => {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot).toLowerCase();
};

/**
 * True when the path names a file the code index parses. An extension the list
 * does not hold is false, so an unknown language never reads as code.
 */
export const codePath = (path: string): boolean =>
  !hasPlainExtension(path) && CODE_EXTENSIONS.includes(extensionOf(path));

const GrepInput = Schema.Struct({
  pattern: Schema.String,
  path: Schema.optional(Schema.String),
  include: Schema.optional(Schema.String),
  literal: Schema.optional(Schema.Boolean),
  caseSensitive: Schema.optional(Schema.Boolean),
  limit: Schema.optional(Schema.Number),
});

const ShellInput = Schema.Struct({
  command: Schema.String,
  workdir: Schema.optional(Schema.String),
});

const ReadInput = Schema.Struct({ path: Schema.String });

export interface ReadInputParsed {
  readonly path: string;
  readonly offset?: number;
  readonly limit?: number;
}

const ReadRangeInput = Schema.Struct({
  path: Schema.String,
  offset: Schema.optional(Schema.Number),
  limit: Schema.optional(Schema.Number),
});

export interface ReadResultShape {
  readonly kind: "text" | "directory" | "media" | "unknown";
  readonly rawText: string;
  readonly rawBytes: number;
  readonly lines: number;
  readonly truncatedByHost: boolean;
}

const SubagentInput = Schema.Struct({
  sessionID: Schema.optional(Schema.String),
  agent: Schema.optional(Schema.String),
});

/** The `subagent` tool's output: the child it created, however the call ended. */
const SpawnedOutput = Schema.Struct({ sessionID: Schema.String });

const decodeGrep = Schema.decodeUnknownOption(GrepInput);
const decodeShell = Schema.decodeUnknownOption(ShellInput);
const decodeRead = Schema.decodeUnknownOption(ReadInput);
const decodeReadRange = Schema.decodeUnknownOption(ReadRangeInput);
const decodeSubagent = Schema.decodeUnknownOption(SubagentInput);
const decodeSpawned = Schema.decodeUnknownOption(SpawnedOutput);

export const decodeReadInput = (input: unknown): ReadInputParsed | undefined =>
  Option.getOrUndefined(decodeReadRange(input));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const encoder = new TextEncoder();

const countLines = (text: string): number => {
  if (text.length === 0) return 0;
  let lines = 1;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) lines += 1;
  }
  return text.endsWith("\n") ? lines - 1 : lines;
};

const emptyReadResult = (kind: ReadResultShape["kind"]): ReadResultShape => ({
  kind,
  rawText: "",
  rawBytes: 0,
  lines: 0,
  truncatedByHost: false,
});

const textReadResult = (rawText: string, truncatedByHost: boolean): ReadResultShape => ({
  kind: "text",
  rawText,
  rawBytes: encoder.encode(rawText).length,
  lines: countLines(rawText),
  truncatedByHost,
});

const extractContentText = (content: unknown): string | undefined => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  const parts: Array<string> = [];
  for (const part of content) {
    if (isRecord(part) && part.type === "text" && typeof part.text === "string") {
      parts.push(part.text);
    }
  }
  return parts.length > 0 ? parts.join("\n") : undefined;
};

const inspectStructuredOutput = (
  output: Record<string, unknown>,
  fallbackContent: unknown,
): ReadResultShape => {
  const outType = output.type;
  if (outType === "directory" || outType === "list-page") return emptyReadResult("directory");
  if (outType === "media" || output.encoding === "base64") return emptyReadResult("media");
  if (outType !== "text") return emptyReadResult("unknown");
  const rawText =
    typeof output.content === "string"
      ? output.content
      : (extractContentText(fallbackContent) ?? "");
  const truncatedByHost = "next" in output && output.next !== undefined;
  return textReadResult(rawText, truncatedByHost);
};

export const inspectReadResult = (result: {
  readonly output?: unknown;
  readonly content?: unknown;
}): ReadResultShape => {
  if (isRecord(result.output)) {
    return inspectStructuredOutput(result.output, result.content);
  }
  if (result.output === undefined) {
    const contentText = extractContentText(result.content);
    if (contentText !== undefined) return textReadResult(contentText, false);
  }
  return emptyReadResult("unknown");
};

const CONTROL_PLANE_BASENAMES: ReadonlySet<string> = new Set([
  "skill.md",
  "agents.md",
  "claude.md",
  "opencode.json",
  "opencode.jsonc",
]);

const CONTROL_PLANE_DIRS: ReadonlySet<string> = new Set([".opencode", ".spectre"]);

const isSkillPath = (path: string): boolean => path.toLowerCase().startsWith(SKILL_SCHEME);

const relativePathSegments = (resolved: string, root: string): ReadonlyArray<string> => {
  const normalized = resolved.replace(/\\/g, "/");
  const normalizedRoot = root.replace(/\\/g, "/");
  const rel =
    normalizedRoot === "/"
      ? normalized.slice(1)
      : normalized === normalizedRoot
        ? ""
        : normalized.startsWith(`${normalizedRoot}/`)
          ? normalized.slice(normalizedRoot.length + 1)
          : normalized;
  return rel.split("/").filter((s) => s.length > 0);
};

export const isControlPlanePath = (
  rawPath: string,
  resolvedPath: string,
  root: string,
): boolean => {
  if (isSkillPath(rawPath)) return true;
  const scopedRaw = scope(root, rawPath);
  const scopedResolved = scope(root, resolvedPath);
  const baseRoot = scope(root, ".");
  if (scopedRaw === undefined || scopedResolved === undefined || baseRoot === undefined) {
    return true;
  }
  const segments = relativePathSegments(scopedResolved, baseRoot);
  if (segments.some((s) => CONTROL_PLANE_DIRS.has(s.toLowerCase()))) return true;
  const last = (segments[segments.length - 1] ?? "").toLowerCase();
  return CONTROL_PLANE_BASENAMES.has(last);
};

const isTextID = (tool: string): tool is "grep" | "ripgrep" =>
  tool === "grep" || tool === "ripgrep";

const isMutateID = (tool: string): tool is "edit" | "write" => tool === "edit" || tool === "write";

/** A skill body is a prompt asset, not a source file, whatever its extension. */
const SKILL_SCHEME = "skill://";

/** The `grep` or `ripgrep` payload, decoded at the edge. Unknown keys are dropped. */
export const grepAsk = (input: unknown, tool: string): SurfaceAsk<"text"> | undefined => {
  if (!isTextID(tool)) return undefined;
  const ask = Option.getOrUndefined(decodeGrep(input));
  if (ask === undefined) return undefined;
  return { surface: "text", id: tool, ask };
};

/** The `shell` payload: the command, read into the shapes the rule acts on. */
export const shellAsk = (input: unknown): SurfaceAsk<"shell"> | undefined =>
  Option.getOrUndefined(
    Option.map(decodeShell(input), ({ command, workdir }): SurfaceAsk<"shell"> => {
      const parsed = shellParse(command);
      return workdir === undefined
        ? { surface: "shell", command, parsed }
        : { surface: "shell", command, parsed, workdir };
    }),
  );

/**
 * The `read` payload. `root` is the project directory, so the reader can say
 * whether the path leaves it; `scope` is the containment check the tool runs
 * before a spawn.
 */
export const readAsk = (input: unknown, root: string): SurfaceAsk<"read"> | undefined => {
  const ask = Option.getOrUndefined(decodeRead(input));
  if (ask === undefined) return undefined;
  return {
    surface: "read",
    path: ask.path,
    code: !isSkillPath(ask.path) && codePath(ask.path),
    insideRoot: scope(root, ask.path) !== undefined,
  };
};

/** The `edit` or `write` payload. A tool that is neither names no mutation. */
export const mutateAsk = (
  input: unknown,
  tool: string,
  root?: string,
): SurfaceAsk<"mutate"> | undefined => {
  if (!isMutateID(tool)) return undefined;
  const ask = Option.getOrUndefined(decodeRead(input));
  if (ask === undefined) return undefined;
  return {
    surface: "mutate",
    tool,
    path: ask.path,
    code: codePath(ask.path),
    ...(root === undefined ? {} : { insideRoot: scope(root, ask.path) !== undefined }),
  };
};

/**
 * The `subagent` payload, read with the call's output. A follow-up names a child
 * and is not a spawn; a spawn names its child only in the output.
 */
export const subagentAsk = (
  input: unknown,
  output: unknown,
): SurfaceAsk<"subagent"> | undefined => {
  const ask = Option.getOrUndefined(decodeSubagent(input));
  if (ask === undefined) return undefined;
  if (ask.sessionID !== undefined && ask.sessionID !== "") return undefined;
  const spawned = Option.getOrUndefined(decodeSpawned(output));
  if (spawned === undefined) return undefined;
  return {
    surface: "subagent",
    child: spawned.sessionID,
    ...(ask.agent === undefined ? {} : { agent: ask.agent }),
  };
};

/** The `context` event: the tool names the request carries, which decides whether a reroute can run. */
export const contextAsk = (input: unknown): SurfaceAsk<"context"> | undefined => {
  if (typeof input !== "object" || input === null || !("tools" in input)) return undefined;
  const tools = input.tools;
  if (typeof tools !== "object" || tools === null) return undefined;
  return { surface: "context", tools: Object.keys(tools) };
};
