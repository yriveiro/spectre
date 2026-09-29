/**
 * A systemic failure is not a routing result. When the model is rate limited,
 * every row fails the same way, and grinding 12 more of them produces 12
 * identical failures and a number that looks like a measurement. The run stops
 * on the first repeat of one reason and says why, so a quota costs a few
 * requests instead of a whole tier.
 */
export const systemic = (
  reasons: ReadonlyArray<string | undefined>,
  threshold: number,
): string | undefined => {
  const seen = new Map<string, number>();
  for (const reason of reasons) {
    if (reason === undefined || reason === "") continue;
    const count = (seen.get(reason) ?? 0) + 1;
    seen.set(reason, count);
    if (count >= threshold) return reason;
  }
  return undefined;
};

/** The leading rows of a corpus, for a tier that has to finish in a coffee break. */
export const head = <T>(rows: ReadonlyArray<T>, count: number): ReadonlyArray<T> =>
  count >= rows.length ? rows : rows.slice(0, count);

/**
 * Whether every requested row produced a result.
 *
 * Counting is deliberate. A halted run leaves a sparse array whose unassigned
 * indices are holes, and `Array.prototype.some` skips holes, so a `some` check
 * reports a halted run as complete and it gets scored. A filtered count does not.
 */
export const complete = (results: ReadonlyArray<unknown>, expected: number): boolean => {
  const filled = results.filter((one) => one !== undefined && one !== null).length;
  return filled === expected;
};
