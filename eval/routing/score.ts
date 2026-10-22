/**
 * The scoring, and the number that matters.
 *
 * A hit rate says the arm chose the label a human chose. It does not say
 * whether the arm was expensive. A wrong profile on a hard task is a redo. A
 * redo costs the price of the model that should have run it, so the report
 * prices every wrong answer.
 *
 * Three failures stay apart, because money does not price all of them. A wrong
 * profile spends the wrong money. An abstention on a judged row leaves the work
 * to run on a profile nobody chose. It spends the same money. A fire on a
 * negative row is a matcher that never stays quiet. It costs nothing, so the
 * report counts it in `fired` and not in the price.
 *
 * The hit rate is over the judged rows. A negative row asks the arm to stay
 * quiet, so it cannot be a hit. An arm that answers `none` to everything must
 * not read as accurate. `fired` measures the negative rows on its own.
 */

import type { Row } from "./fixture";

export const NONE = "none";

/** The answer of a row that a broken arm never reached. It is not `none`, which the arm chose. */
const NO_REPLY = "(no reply)";

/** What one profile costs, in the units the catalogue uses. */
export type Price = {
  readonly profile: string;
  /** The blended rate per million tokens, input plus output. */
  readonly rate: number;
  /** The thinking the profile asks for. */
  readonly effort: string | undefined;
};

export type Miss = {
  readonly prompt: string;
  readonly want: string;
  readonly got: string;
  /** The price of being wrong, in the catalogue's units. */
  readonly cost: number;
};

export type PerProfile = {
  readonly profile: string;
  readonly rows: number;
  readonly hit: number;
  /** The total price of this profile's wrong answers. */
  readonly regret: number;
};

export type Report = {
  /** The judged rows, where a profile was expected. A negative row is not scored. */
  readonly scored: number;
  readonly hit: number;
  readonly hitRate: number;
  /** The rows where the arm stayed quiet. */
  readonly abstained: number;
  /** The rows where no profile fits and the arm said one anyway. */
  readonly fired: number;
  readonly byProfile: ReadonlyArray<PerProfile>;
  readonly misses: ReadonlyArray<Miss>;
  /** The total price of every wrong answer. */
  readonly regret: number;
  /** The same price, over the rows that were judged. */
  readonly regretPerRow: number;
};

/**
 * The score for one arm.
 *
 * A wrong profile costs the price of the profile that should have run, because
 * the task gets done on the wrong model and has to be redone. A hit costs
 * nothing: the profile decides the model, so a hit has no rung to be wrong
 * about. An arm that stayed quiet on a judged row pays the price of the profile
 * a human named, because the work still runs somewhere. A fire on a negative
 * row pays nothing and is counted in `fired`.
 *
 * A row with no prediction is a miss, never a silent pass. A judged profile
 * with no price stops the report, because a redo priced at zero reads as free.
 */
export const score = (
  rows: ReadonlyArray<Row>,
  predictions: ReadonlyArray<{ readonly prompt: string; readonly got: string }>,
  prices: ReadonlyArray<Price>,
): Report => {
  const answered = new Map(predictions.map((one) => [one.prompt, one.got]));
  const rate = new Map(prices.map((one) => [one.profile, one.rate]));

  // One entry per profile the corpus judges, in the order the corpus first
  // names it. A profile the corpus does not exercise gets no row, because a
  // row of zeros and a clean sheet look the same to a reader.
  const per = new Map<string, { rows: number; hit: number; regret: number }>();
  const misses: Array<Miss> = [];
  let scored = 0;
  let hit = 0;
  let abstained = 0;
  let fired = 0;
  let regret = 0;

  for (const row of rows) {
    const got = answered.get(row.prompt) ?? NO_REPLY;

    if (row.provenance === "neg") {
      if (got === NONE) continue;
      if (got !== NO_REPLY) fired += 1;
      misses.push({ prompt: row.prompt, want: NONE, got, cost: 0 });
      continue;
    }

    // The lookup runs for every judged row, whatever the arm answered. A
    // missing price stops the report, and not only the arm that missed.
    const price = rate.get(row.label);
    if (price === undefined)
      throw new Error(
        `no price for the profile "${row.label}" on row "${row.prompt}", and a redo priced at zero reads as free`,
      );

    const entry = per.get(row.label) ?? { rows: 0, hit: 0, regret: 0 };
    per.set(row.label, entry);
    scored += 1;
    entry.rows += 1;

    if (got === row.label) {
      hit += 1;
      entry.hit += 1;
      continue;
    }

    if (got === NONE) abstained += 1;
    regret += price;
    entry.regret += price;
    misses.push({ prompt: row.prompt, want: row.label, got, cost: price });
  }

  return {
    scored,
    hit,
    hitRate: scored === 0 ? 0 : hit / scored,
    abstained,
    fired,
    byProfile: [...per].map(([profile, entry]) => ({ profile, ...entry })),
    misses,
    regret,
    regretPerRow: scored === 0 ? 0 : regret / scored,
  };
};
