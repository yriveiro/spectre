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
 * Precedence, measured at `v2.1.1`:
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

/** The one file this directory contributes: the canonical name when it is there. */
const oneFile = (directory: string): Effect.Effect<string | undefined> =>
  Effect.gen(function* () {
    const canonical = join(directory, FILE_NAME);
    if (yield* Effect.promise(() => Bun.file(canonical).exists())) return canonical;
    const legacy = join(directory, LEGACY_NAME);
    return (yield* Effect.promise(() => Bun.file(legacy).exists())) ? legacy : undefined;
  });

/**
 * Lowest precedence first: the global file, then the project's. One file per
 * directory, so a directory holding both is read as the canonical one says and
 * the other is ignored — which one is a fact the tool reports through its
 * sources, not one a reader has to guess.
 */
export const configPaths = (directory: string): Effect.Effect<ReadonlyArray<string>> =>
  Effect.gen(function* () {
    const global = yield* globalConfigDir;
    const paths: Array<string | undefined> = [
      global === undefined ? undefined : yield* oneFile(global),
      yield* oneFile(directory),
    ];
    return paths.filter((one): one is string => one !== undefined);
  });
