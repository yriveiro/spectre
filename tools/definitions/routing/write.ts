import { rename } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { Effect } from "effect";
import { decode } from "./load";
import type { File, Known } from "./types";

/**
 * Writing the config.
 *
 * The file is JSON. The reader tolerates comments and the writer never writes
 * one, so the writer owns the whole file and the reader owns nothing of it.
 * The writer decodes what is there before it writes, so a working config is
 * never overwritten by a broken one.
 */

/**
 * The file as it is written: plain JSON, two spaces, one trailing newline.
 *
 * The top-level keys are written in one order, whatever order the object
 * carries them in, so two writes of the same config differ by nothing. Inside
 * `models` the user's own order is kept, because that order is the preference
 * order the resolver reads.
 */
export const serialise = (config: File): string => {
  const ordered: Record<string, unknown> = {};
  if (config.$schema !== undefined) ordered.$schema = config.$schema;
  for (const key of ["provider", "models", "profiles", "judge", "dictionary", "setup"] as const)
    if (config[key] !== undefined) ordered[key] = config[key];
  return `${JSON.stringify(ordered, null, 2)}\n`;
};

/**
 * The problem with the file that is there, or `undefined` when it decodes.
 *
 * The reader owns the decode, so the writer refuses exactly what the reader
 * refuses and one change to the rule is a change in one place.
 */
const decodes = (path: string, text: string): string | undefined => decode(path, text).problem;

/**
 * The config written to `path`. It fails when the file there does not decode,
 * and it never writes over a file it could not read. The failure is in the
 * error channel and carries the message, because a writer that cannot say why
 * it refused is a writer the caller has to guess about.
 *
 * `Bun.rename` does not exist and `Bun.write` documents no atomicity, so the
 * file is written to a temporary name beside the target and renamed over it.
 * Beside, never in the system temporary directory, because a rename across
 * filesystems is a copy, and a copy is the half-written file this exists to
 * prevent.
 */
export const writeConfig = (path: string, config: File): Effect.Effect<void, string> =>
  Effect.gen(function* () {
    const target = Bun.file(path);
    if (yield* Effect.promise(() => target.exists())) {
      const problem = decodes(path, yield* Effect.promise(() => target.text()));
      if (problem !== undefined) return yield* Effect.fail(problem);
    }
    const temp = join(dirname(path), `.${basename(path)}.${Bun.randomUUIDv7()}.tmp`);
    yield* Effect.promise(() => Bun.write(temp, serialise(config)));
    yield* Effect.promise(() => rename(temp, path));
  });

const slug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/**
 * The id with the family prefix taken off, when the id starts with it.
 * `muse` against `muse-spark-1.3-contributor` leaves `spark-1.3-contributor`.
 * An id that does not carry the family as its head is all tail.
 */
const tailOf = (id: string, family: string | undefined): string => {
  if (family === undefined) return id;
  if (!id.toLowerCase().startsWith(family.toLowerCase())) return id;
  const rest = id.slice(family.length).replace(/^[^a-zA-Z0-9]+/, "");
  return rest === "" ? id : rest;
};

/**
 * The alias a model gets in the allowlist: its family, then the tail of its
 * id when the family is taken, then the provider.
 *
 * A slug is lowercase alphanumerics and hyphens, and never starts or ends with
 * a hyphen, so the result always meets the alias charset
 * `^[a-z0-9][a-z0-9-]*$` and can never be mistaken for a ref.
 */
export const proposeAlias = (model: Known, taken: ReadonlyArray<string>): string => {
  const hold = new Set(taken);
  const base = model.family === undefined ? "" : slug(model.family);
  const tail = slug(tailOf(model.id, model.family));
  const provider = slug(model.providerID);
  // No family, or a family that slugs to nothing: the tail leads and the
  // provider follows, which is the same ladder with the first rung off. An id
  // that slugs to the family itself has no second rung, because `base-base`
  // would repeat the first one.
  const extend = (part: string) => (base === "" ? part : `${base}-${part}`);
  const options: Array<string> = [];
  if (base !== "") options.push(base);
  if (base === "" ? tail !== "" : tail !== base) options.push(extend(tail));
  options.push(extend(provider));
  for (const one of new Set(options)) if (one !== "" && !hold.has(one)) return one;
  // Every rung is taken. A number on the last one is the only name left that
  // stays inside the charset, and the page lets the user rename it anyway.
  let n = 2;
  for (;;) {
    const one = `${options[options.length - 1]}-${n}`;
    if (!hold.has(one)) return one;
    n++;
  }
};
