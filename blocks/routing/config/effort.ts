/**
 * The effort rule, and nothing else.
 *
 * The catalogue speaks effort names, so this module speaks them too. The known
 * order is one constant, and a name outside it is comparable only to itself.
 * Nothing here reads the catalogue and nothing here reads a config, so every
 * decision about an effort is made in one file and nowhere else.
 */

/** The order the resolver compares by, ascending. */
export const KNOWN_ORDER = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export type KnownEffort = (typeof KNOWN_ORDER)[number];

/**
 * An effort name as written. A known name carries its rank. An unknown name,
 * a provider's own `turbo`, is comparable only to itself.
 */
export type Effort =
  | { readonly kind: "known"; readonly name: KnownEffort; readonly rank: number }
  | { readonly kind: "unknown"; readonly name: string };

/**
 * A model's rungs, split in two because a name the order cannot rank has no
 * place in an ordered list. Putting it in one would invent a position for it.
 */
export type Ladder = {
  /** The rungs the known order ranks, ascending. */
  readonly ranked: ReadonlyArray<KnownEffort>;
  /** The rungs the known order cannot rank. Exact match only, never a step up. */
  readonly unranked: ReadonlyArray<string>;
};

/**
 * What a model will be asked for. `rung` is a model that meets the
 * requirement, `floor` is a model with no thinking control at all, and `short`
 * is a model that cannot reach it.
 */
export type Fit =
  | {
      readonly kind: "rung";
      /** The rung to ask for. */
      readonly at: Effort;
      /** The requirement, kept so the report can name the gap. */
      readonly want: Effort;
      /** The rung below the one used, when the ladder holds one. */
      readonly below: Effort | undefined;
    }
  | { readonly kind: "floor" }
  | { readonly kind: "short"; readonly best: Effort | undefined };

/** The rank of a known name, or `-1` for a name the order cannot rank. */
const rankOf = (name: string): number => KNOWN_ORDER.indexOf(name as KnownEffort);

/** The name as a requirement: a known name with its rank, or an unknown one. */
export const effortOf = (name: string): Effort => {
  const rank = rankOf(name);
  if (rank === -1) return { kind: "unknown", name };
  return { kind: "known", name: name as KnownEffort, rank };
};

/**
 * The rungs a model holds, read as a ladder and sorted by the known order.
 *
 * The variant ids are the effort names, because the host builds the variants
 * from the provider's own effort list. `packages/core/src/variant.ts:13-22`
 * reads that list, `:49-50` maps each declared value through unchanged, and
 * `:29-38` resolves the protocol, all at `v2.1.1`. The array order is that
 * provider's taste and not a ladder order, because
 * `packages/core/src/models-dev.ts:115` stores the result with no sort at
 * `v2.1.1`. A provider that declared `["high", "low"]` would make a resolver
 * that trusted the array order step down, so the order here is the known
 * order.
 */
export const ladderOf = (variants: ReadonlyArray<{ readonly id: string }>): Ladder => {
  const ranked: Array<KnownEffort> = [];
  const unranked: Array<string> = [];
  const seen = new Set<string>();

  for (const one of variants) {
    // One id twice is one rung. The host removes the duplicate as well
    // (`packages/core/src/variant.ts:37` at `v2.1.1`), and a ladder that
    // counted it twice would misreport its own capacity.
    if (seen.has(one.id)) continue;
    seen.add(one.id);

    const effort = effortOf(one.id);
    if (effort.kind === "known") ranked.push(effort.name);
    else unranked.push(effort.name);
  }

  ranked.sort((a, b) => rankOf(a) - rankOf(b));
  return { ranked, unranked };
};

/** The highest rung the order can place, or undefined when there is none. */
const highest = (one: Ladder): Effort | undefined => {
  let top: KnownEffort | undefined;
  for (const name of one.ranked) if (top === undefined || rankOf(name) > rankOf(top)) top = name;
  return top === undefined ? undefined : effortOf(top);
};

/** The lowest rung at or above `rank`, or undefined when none clears it. */
const lowestAtOrAbove = (one: Ladder, rank: number): KnownEffort | undefined => {
  let found: KnownEffort | undefined;
  for (const name of one.ranked) {
    if (rankOf(name) < rank) continue;
    if (found === undefined || rankOf(name) < rankOf(found)) found = name;
  }
  return found;
};

/** The highest rung under `rank`, or undefined when the ladder starts above it. */
const highestUnder = (one: Ladder, rank: number): KnownEffort | undefined => {
  let found: KnownEffort | undefined;
  for (const name of one.ranked) {
    if (rankOf(name) >= rank) continue;
    if (found === undefined || rankOf(name) > rankOf(found)) found = name;
  }
  return found;
};

/** The rung this ladder is asked for when the requirement is `want`. */
export const fit = (one: Ladder, want: Effort): Fit => {
  // A model with no rungs at all has no thinking control. It is spent at its
  // own default whatever the requirement says, so the requirement is not read.
  // A toggle model is not this case: it declares `none` and `thinking`, so it
  // holds a rung (`packages/core/src/variant.ts:36` and `:52` at `v2.1.1`).
  if (one.ranked.length === 0 && one.unranked.length === 0) return { kind: "floor" };

  if (want.kind === "unknown") {
    // An unknown name is comparable only to itself, so a provider's `turbo` is
    // served by a model that declares `turbo` and never by a step up. The rung
    // has no position in the order, so nothing is below it.
    if (one.unranked.includes(want.name)) return { kind: "rung", at: want, want, below: undefined };
    return { kind: "short", best: highest(one) };
  }

  // The search reads the ranks and not the array order, so a ladder built
  // anywhere else answers the same however its rungs are arranged.
  const at = lowestAtOrAbove(one, want.rank);
  if (at === undefined) {
    // The ladder stops under the requirement. `best` is the highest rung the
    // order can place, so the report can say how far short it is. A ladder
    // whose rungs are all unranked reaches nothing the order can measure.
    return { kind: "short", best: highest(one) };
  }

  // `none` is rank 0, so the rule above answers it without a special case: a
  // model that has rungs is spent at its lowest rung, and `want` then differs
  // from `at`, so the report says it stepped up. This is the choice that
  // `features/routing.md` leaves open under "What does `none` mean": `none` is
  // the floor of a model, not an exact request for an off switch. A toggle
  // ladder declares `none` itself, so `none` stays exact there.
  //
  // `below` is the neighbour under the rung used, so the report can name the
  // gap: `medium` on `low, high, max` is `high`, below `low`.
  const below = highestUnder(one, rankOf(at));
  return {
    kind: "rung",
    at: effortOf(at),
    want,
    below: below === undefined ? undefined : effortOf(below),
  };
};

/** The rungs as a person reads them: the ranked ones, then the unranked ones. */
export const rungs = (one: Ladder): ReadonlyArray<string> => [...one.ranked, ...one.unranked];
