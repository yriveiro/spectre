import { join } from "node:path";
import { Effect } from "effect";

/** The canonical name. The reader writes this and takes it first. */
export const FILE_NAME = "spectre.json";

/**
 * The name the reader wrote before the file was JSON. Still read, so an
 * existing setup keeps working, and its comments are ignored rather than
 * rejected. One directory never contributes both: the canonical file wins and
 * this one is left alone.
 */
export const LEGACY_NAME = "spectre.jsonc";

const set = (name: string): string | undefined => {
  const value = Bun.env[name];
  return value === undefined || value === "" ? undefined : value;
};

/**
 * The directory holding the global config, or `undefined` when the environment
 * cannot name one. Never guesses a path it was not given.
 *
 * No plugin context domain names this directory, so the host's precedence is
 * repeated here, read at `v2.3.0`:
 *   - `util/src/global.ts:79` — `OPENCODE_CONFIG_DIR ?? Path.config`
 *   - `util/src/global-roots.ts:7` — `XDG_CONFIG_HOME || home/.config`, and
 *     `roots(app)` joins that with `"opencode"` at line 15
 */
const globalConfigDir: Effect.Effect<string | undefined> = Effect.sync((): string | undefined => {
  const configured = set("OPENCODE_CONFIG_DIR");
  if (configured !== undefined) return configured;

  const xdg = set("XDG_CONFIG_HOME");
  if (xdg !== undefined) return join(xdg, "opencode");

  const home = set("HOME");
  return home === undefined ? undefined : join(home, ".config", "opencode");
});

const oneFile = (directory: string): Effect.Effect<string | undefined> =>
  Effect.gen(function* () {
    const canonical = join(directory, FILE_NAME);
    if (yield* Effect.promise(() => Bun.file(canonical).exists())) return canonical;
    const legacy = join(directory, LEGACY_NAME);
    return (yield* Effect.promise(() => Bun.file(legacy).exists())) ? legacy : undefined;
  });

const gitOut = async (cwd: string, args: ReadonlyArray<string>): Promise<string | undefined> => {
  let proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
  try {
    proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  } catch {
    return undefined;
  }
  const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return code === 0 ? out.trim() : undefined;
};

const parseWorktreeBlock = (block: string) => {
  let directory: string | undefined;
  let branch: string | undefined;
  let bare = false;
  for (const line of block.split("\n")) {
    if (line.startsWith("worktree ")) directory = line.slice("worktree ".length).trim();
    else if (line === "bare") bare = true;
    else if (line.startsWith("branch refs/heads/"))
      branch = line.slice("branch refs/heads/".length).trim();
  }
  return directory === undefined ? undefined : { directory, branch, bare };
};

const parseMainWorktree = (porcelain: string): string | undefined => {
  const rows = porcelain
    .trim()
    .split("\n\n")
    .flatMap((block) => {
      const parsed = parseWorktreeBlock(block);
      return parsed === undefined ? [] : [parsed];
    });
  return (
    rows.find((one) => one.branch === "main")?.directory ?? rows.find((one) => !one.bare)?.directory
  );
};

const linkedWorktreeMain = async (directory: string): Promise<string | undefined> => {
  if (!(await Bun.file(join(directory, ".git")).exists())) return undefined;
  const [top, porcelain] = await Promise.all([
    gitOut(directory, ["rev-parse", "--path-format=absolute", "--show-toplevel"]),
    gitOut(directory, ["worktree", "list", "--porcelain"]),
  ]);
  if (top === undefined || porcelain === undefined) return undefined;
  const mainDir = parseMainWorktree(porcelain);
  return mainDir === undefined || mainDir === top ? undefined : mainDir;
};

const hasLocalConfigChanges = async (directory: string): Promise<boolean> => {
  const status = await gitOut(directory, ["status", "--porcelain", "--", FILE_NAME, LEGACY_NAME]);
  return status !== undefined && status !== "";
};

const resolveProjectFile = (directory: string): Effect.Effect<string | undefined> =>
  Effect.gen(function* () {
    const mainDir = yield* Effect.promise(() => linkedWorktreeMain(directory));
    if (mainDir === undefined) return yield* oneFile(directory);
    const [localFile, mainFile, localDirty] = yield* Effect.all(
      [
        oneFile(directory),
        oneFile(mainDir),
        Effect.promise(() => hasLocalConfigChanges(directory)),
      ],
      { concurrency: "unbounded" },
    );
    if (localFile !== undefined && localDirty) return localFile;
    return mainFile ?? localFile;
  });

export const writePath = (directory: string): Effect.Effect<string> =>
  Effect.gen(function* () {
    const mainDir = yield* Effect.promise(() => linkedWorktreeMain(directory));
    if (mainDir === undefined) return join(directory, FILE_NAME);
    if (yield* Effect.promise(() => hasLocalConfigChanges(directory))) {
      return join(directory, FILE_NAME);
    }
    return join(mainDir, FILE_NAME);
  });

export const inheritedConfigPath = (directory: string): Effect.Effect<string | undefined> =>
  resolveProjectFile(directory);

export const configPaths = (directory: string): Effect.Effect<ReadonlyArray<string>> =>
  Effect.gen(function* () {
    const global = yield* globalConfigDir;
    const paths: Array<string | undefined> = [
      global === undefined ? undefined : yield* oneFile(global),
      yield* resolveProjectFile(directory),
    ];
    return paths.filter((one): one is string => one !== undefined);
  });
