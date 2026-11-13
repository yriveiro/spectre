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

const ShellInput = Schema.Struct({ command: Schema.String });

const ReadInput = Schema.Struct({ path: Schema.String });

const SubagentInput = Schema.Struct({ sessionID: Schema.optional(Schema.String) });

/** The `subagent` tool's output: the child it created, however the call ended. */
const SpawnedOutput = Schema.Struct({ sessionID: Schema.String });

const decodeGrep = Schema.decodeUnknownOption(GrepInput);
const decodeShell = Schema.decodeUnknownOption(ShellInput);
const decodeRead = Schema.decodeUnknownOption(ReadInput);
const decodeSubagent = Schema.decodeUnknownOption(SubagentInput);
const decodeSpawned = Schema.decodeUnknownOption(SpawnedOutput);

const isTextID = (tool: string): tool is "grep" | "ripgrep" => tool === "grep" || tool === "ripgrep";

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
export const shellAsk = (input: unknown): SurfaceAsk<"shell"> | undefined => {
  const ask = Option.getOrUndefined(decodeShell(input));
  if (ask === undefined) return undefined;
  return { surface: "shell", command: ask.command, parsed: shellParse(ask.command) };
};

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
    code: !ask.path.startsWith(SKILL_SCHEME) && codePath(ask.path),
    insideRoot: scope(root, ask.path) !== undefined,
  };
};

/** The `edit` or `write` payload. A tool that is neither names no mutation. */
export const mutateAsk = (input: unknown, tool: string): SurfaceAsk<"mutate"> | undefined => {
  if (!isMutateID(tool)) return undefined;
  const ask = Option.getOrUndefined(decodeRead(input));
  if (ask === undefined) return undefined;
  return { surface: "mutate", tool, path: ask.path };
};

/**
 * The `subagent` payload, read with the call's output. A follow-up names a child
 * and is not a spawn; a spawn names its child only in the output.
 */
export const subagentAsk = (input: unknown, output: unknown): SurfaceAsk<"subagent"> | undefined => {
  const ask = Option.getOrUndefined(decodeSubagent(input));
  if (ask === undefined) return undefined;
  if (ask.sessionID !== undefined && ask.sessionID !== "") return undefined;
  const spawned = Option.getOrUndefined(decodeSpawned(output));
  if (spawned === undefined) return undefined;
  return { surface: "subagent", child: spawned.sessionID };
};

/** The `prompt` event. Discovery reads no field of the prompt itself. */
export const promptAsk = (input: unknown): SurfaceAsk<"prompt"> | undefined => {
  if (typeof input !== "object" || input === null) return undefined;
  return { surface: "prompt" };
};

/** The `context` event: the tool names the request carries, which decides whether a reroute can run. */
export const contextAsk = (input: unknown): SurfaceAsk<"context"> | undefined => {
  if (typeof input !== "object" || input === null || !("tools" in input)) return undefined;
  const tools = input.tools;
  if (typeof tools !== "object" || tools === null) return undefined;
  return { surface: "context", tools: Object.keys(tools) };
};
