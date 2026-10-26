import { dirname, resolve } from "node:path";
import { Effect, Schema } from "effect";
import { configPaths, projectPath } from "./locate";
import { Config, DEFAULT_PROFILES, type File, type ProfileEntry, type Tables } from "./types";

/**
 * Effect renders a decode failure as a sentence plus an `at [...]` chain, which
 * carries the path. Joining the keys turns it into one line naming the key.
 */
const flatten = (message: string): string => {
  const cut = message.lastIndexOf("\n  at [");
  if (cut === -1) return message;
  const path = [...message.slice(cut + 7).matchAll(/"([^"]*)"/g)].map((one) => one[1]);
  return path.length === 0 ? message.slice(0, cut) : `${path.join(".")}: ${message.slice(0, cut)}`;
};

/**
 * The config in a file's text, or the problem with it.
 *
 * The writer asks this question before it replaces a file, so the reader and
 * the writer refuse the same things. One implementation, so a change to the
 * rule is a change in one place.
 */
export const decode = (path: string, text: string): { file?: File; problem?: string } => {
  let raw: unknown;
  try {
    raw = Bun.JSONC.parse(text);
  } catch (e) {
    // `Bun.JSONC.parse` reports the same line and column for every broken
    // document, and ignores anything after the first complete value. So the
    // message is reported and the position is not: the position is wrong.
    return { problem: `${path}: ${(e as Error).message}` };
  }
  try {
    return {
      file: Schema.decodeUnknownSync(Config, { onExcessProperty: "error" })(raw),
    };
  } catch (e) {
    return { problem: `${path}: ${flatten((e as Error).message)}` };
  }
};

const read = (path: string) =>
  Effect.gen(function* () {
    const file = Bun.file(path);
    if (!(yield* Effect.promise(() => file.exists()))) return undefined;
    return { path, text: yield* Effect.promise(() => file.text()) };
  });

const one = (entry: ProfileEntry) => ({
  ...entry,
  model: typeof entry.model === "string" ? [entry.model] : entry.model,
});

const settle = <T, R>(
  record: Readonly<Record<string, T | null>> | undefined,
  transform: (value: T) => R,
): Readonly<Record<string, R>> => {
  const out: Record<string, R> = {};
  for (const [key, value] of Object.entries(record ?? {}))
    if (value !== null) out[key] = transform(value);
  return out;
};

/** The tables of a repository with no config. */
const emptyTables = (): Tables => ({
  provider: undefined,
  judge: undefined,
  models: {},
  profiles: {},
});

export type Loaded = {
  readonly tables: Tables;
  readonly sources: ReadonlyArray<string>;
  readonly problems: ReadonlyArray<string>;
  readonly configuredProfiles: boolean;
};

/**
 * The project's own config, with no global file merged into it.
 *
 * The tool merges, so the session sees the user's defaults on top of the
 * repository's. The page edits the repository's file, and writing the merged
 * result would copy the global config into the repository, which is a change
 * nobody asked for.
 */
export const loadProject = (directory: string): Effect.Effect<Loaded> =>
  Effect.gen(function* () {
    const path = yield* projectPath(directory);
    if (path === undefined)
      return { tables: emptyTables(), sources: [], problems: [], configuredProfiles: false };
    const found = yield* read(path);
    if (found === undefined)
      return { tables: emptyTables(), sources: [], problems: [], configuredProfiles: false };
    const decoded = decode(found.path, found.text);
    if (decoded.problem !== undefined)
      return {
        tables: emptyTables(),
        sources: [],
        problems: [decoded.problem],
        configuredProfiles: false,
      };
    if (decoded.file === undefined)
      return { tables: emptyTables(), sources: [], problems: [], configuredProfiles: false };
    const configuredProfiles =
      decoded.file.profiles !== undefined && Object.keys(decoded.file.profiles).length > 0;
    const settledProfiles = settle(decoded.file.profiles, one);
    return {
      tables: {
        provider: decoded.file.provider,
        judge: decoded.file.judge === null ? undefined : decoded.file.judge,
        setup: decoded.file.setup === undefined ? undefined : { from: found.path },
        models: settle(decoded.file.models, (value) => value),
        profiles: configuredProfiles ? settledProfiles : { ...DEFAULT_PROFILES },
        dictionary:
          decoded.file.dictionary === undefined || decoded.file.dictionary === null
            ? undefined
            : {
                path: resolve(dirname(found.path), decoded.file.dictionary),
                from: found.path,
              },
      },
      sources: [found.path],
      problems: [],
      configuredProfiles,
    };
  });

/** Lowest precedence first. A later entry replaces the earlier one whole. */
export const load = (directory: string): Effect.Effect<Loaded> =>
  Effect.gen(function* () {
    const found = yield* Effect.forEach(yield* configPaths(directory), read);

    // `null` is kept through the merge, because a removal is a value that
    // overwrites the key it removes. Dropping it first would leave the earlier
    // value standing.
    let models: Record<string, string | null> = {};
    let profiles: Record<string, ProfileEntry | null> = {};
    let configuredProfiles = false;
    let provider: string | undefined;
    // A judge is asked for or not asked for. A file that says nothing leaves an
    // earlier file's answer standing, and a file that says `null` removes it,
    // which is how a repository turns a judge off.
    let judge: Tables["judge"];
    let setup: { from: string } | undefined;
    // A string here is the path as written, and the file it was written in, so a
    // relative path resolves against the config that named it rather than against
    // whatever the process happens to be in.
    let dictionary: { path: string; from: string } | undefined;
    const sources: Array<string> = [];
    const problems: Array<string> = [];

    for (const source of found) {
      if (source === undefined) continue;
      const read = decode(source.path, source.text);
      if (read.problem !== undefined) {
        problems.push(read.problem);
        continue;
      }
      if (read.file === undefined) continue;
      sources.push(source.path);
      models = { ...models, ...read.file.models };
      profiles = { ...profiles, ...read.file.profiles };
      if (read.file.profiles !== undefined && Object.keys(read.file.profiles).length > 0) {
        configuredProfiles = true;
      }
      if (read.file.provider !== undefined) provider = read.file.provider;
      if (read.file.judge !== undefined)
        judge = read.file.judge === null ? undefined : read.file.judge;
      // Each file answers the setup question for itself. A later file with no
      // answer clears an earlier one, so a project config over a global decline
      // routes rather than staying silent.
      setup = read.file.setup === undefined ? undefined : { from: source.path };

      // `null` removes a path an earlier file set, and `undefined` leaves the
      // earlier one standing. A key the reader did not write must not clear it.
      if (read.file.dictionary !== undefined) {
        dictionary =
          read.file.dictionary === null
            ? undefined
            : { path: resolve(dirname(source.path), read.file.dictionary), from: source.path };
      }
    }

    const settledProfiles = settle(profiles, one);

    return {
      tables: {
        provider,
        judge,
        setup,
        models: settle(models, (value) => value),
        profiles:
          sources.length > 0 && !configuredProfiles && setup === undefined
            ? { ...DEFAULT_PROFILES }
            : settledProfiles,
        dictionary,
      },
      sources,
      problems,
      configuredProfiles,
    };
  });
