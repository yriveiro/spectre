/**
 * What each profile costs, priced by the product's own resolver.
 *
 * The corpus is measured against the routing the tool actually does, so the
 * price of a profile is the price of the model the resolver picks for it, in
 * the live catalogue. A price invented for the eval would measure the wrong
 * thing.
 */

import type { Price } from "./score";

/** A row of the config's profile table, as the resolver reads it. */
export type ProfileRow = {
  readonly name: string;
  readonly effort: string | undefined;
};

/** The resolver of the runner's wiring, one profile at a time. */
export type Resolver = (
  profile: string,
) => { readonly rate: number; readonly effort: string | undefined } | undefined;

/**
 * The price of every profile, from the resolver and the catalogue.
 *
 * A profile the resolver cannot serve gets no price, and none is the honest
 * answer: the resolver found no model for it, so there is no price to quote.
 * A price of zero would read as a redo that costs nothing, which is the one
 * number this harness must not invent. The caller holds the corpus, so it
 * refuses the run when a row the corpus judges names a profile with no price.
 */
export const prices = (profiles: ReadonlyArray<ProfileRow>, resolve: Resolver): ReadonlyArray<Price> =>
  profiles.flatMap((one) => {
    const priced = resolve(one.name);
    if (priced === undefined) return [];
    return [{ profile: one.name, rate: priced.rate, effort: one.effort }];
  });
