import { join } from "node:path";
import { Effect } from "effect";

export const FILE_NAME = "spectre.jsonc";

const set = (name: string): string | undefined => {
  const value = Bun.env[name];
  return value === undefined || value === "" ? undefined : value;
};

/**
 * The directory holding the global config, or `undefined` when the environment
 * cannot name one. Never guesses a path it was not given.
 *
 * Precedence, measured at `v2.0.18`:
 *   - `core/src/config/global.ts:79` — `OPENCODE_CONFIG_DIR ?? Path.config`
 *   - `core/src/config/global-roots.ts:8` — `XDG_CONFIG_HOME || home/.config`,
 *     then `join(..., "opencode")`
 */
const globalConfigDir: Effect.Effect<string | undefined> = Effect.sync(
  (): string | undefined => {
    const configured = set("OPENCODE_CONFIG_DIR");
    if (configured !== undefined) return configured;

    const xdg = set("XDG_CONFIG_HOME");
    if (xdg !== undefined) return join(xdg, "opencode");

    const home = set("HOME");
    return home === undefined ? undefined : join(home, ".config", "opencode");
  },
);

/** Lowest precedence first: the global file, then the project's. */
export const configPaths = (
  directory: string,
): Effect.Effect<ReadonlyArray<string>> =>
  Effect.map(globalConfigDir, (global) =>
    [
      global === undefined ? undefined : join(global, FILE_NAME),
      join(directory, FILE_NAME),
    ].filter((one): one is string => one !== undefined),
  );
