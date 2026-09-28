import { Effect, Schema } from "effect";
import { configPaths } from "./locate";
import { Config, type File, type ProfileEntry, type Tables } from "./types";

/**
 * Effect renders a decode failure as a sentence plus an `at [...]` chain, which
 * carries the path. Joining the keys turns it into one line naming the key.
 */
const flatten = (message: string): string => {
  const cut = message.lastIndexOf("\n  at [");
  if (cut === -1) return message;
  const path = [...message.slice(cut + 7).matchAll(/"([^"]*)"/g)].map((one) => one[1]);
  return path.length === 0
    ? message.slice(0, cut)
    : `${path.join(".")}: ${message.slice(0, cut)}`;
};

const decode = (path: string, text: string): { file?: File; problem?: string } => {
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

export type Loaded = {
  readonly tables: Tables;
  readonly sources: ReadonlyArray<string>;
  readonly problems: ReadonlyArray<string>;
};

/** Lowest precedence first. A later entry replaces the earlier one whole. */
export const load = (directory: string): Effect.Effect<Loaded> =>
  Effect.gen(function* () {
    const found = yield* Effect.forEach(yield* configPaths(directory), read);

    // `null` is kept through the merge, because a removal is a value that
    // overwrites the key it removes. Dropping it first would leave the earlier
    // value standing.
    let models: Record<string, string | null> = {};
    let profiles: Record<string, ProfileEntry | null> = {};
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
    }

    return {
      tables: {
        models: settle(models, (value) => value),
        profiles: settle(profiles, one),
      },
      sources,
      problems,
    };
  });
