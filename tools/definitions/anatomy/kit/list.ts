/**
 * The two list accessors every geometry loop in the kit goes through.
 *
 * Rings, frames and profiles are walked by station, so an index is computed from
 * the shape rather than proved at the call site. Both helpers wrap that one
 * assumption here instead of at every use.
 */

/** Index into a list, wrapping in either direction. */
export const pick = <T>(list: ReadonlyArray<T>, index: number): T =>
  list[((index % list.length) + list.length) % list.length] as T;

/** The head of a list the caller has already proved non-empty. */
export const head = <T>(list: ReadonlyArray<T>): T => {
  const value = list[0];
  if (value === undefined) throw new Error("expected a non-empty list");
  return value;
};
