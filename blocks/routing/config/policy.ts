import { KNOWN_ORDER } from "./effort";
import type { Profile } from "./types";

/**
 * What to spend, given what the judge said.
 *
 * The policy is a decision and not a side effect, so it lives here and the
 * tool asks it. It reads the judge's probability and it does not read the
 * catalogue, the models or the resolver.
 */

/** The probability below which a judge is treated as unsure. */
export const PLAY_SAFE = 0.7;

export type Choice = {
  /** The profile to spend. */
  readonly profile: string;
  /** The effort to spend it at, when it is not the profile's own. */
  readonly effort: string | undefined;
  /** True when the profile is spent above its own effort. */
  readonly escalated: boolean;
  /** The judge's other readings, best first. */
  readonly alternatives: ReadonlyArray<{
    readonly profile: string;
    readonly probability: number;
  }>;
};

/**
 * The effort one step above the profile's own.
 *
 * The canonical order is the ladder every model shares, so one step up it is
 * one step of thinking for every model that can take it. A profile already at
 * the top stays there: there is nothing above the ceiling to play safe with.
 * A name the order cannot rank is left alone, because a rung nobody can place
 * has no step above it.
 */
export const oneStepUp = (effort: string | undefined): string | undefined => {
  if (effort === undefined) return undefined;
  const at = KNOWN_ORDER.indexOf(effort as (typeof KNOWN_ORDER)[number]);
  if (at < 0) return effort;
  return KNOWN_ORDER[Math.min(at + 1, KNOWN_ORDER.length - 1)];
};

/**
 * What to spend, given what the judge said.
 *
 * The facts go in, not a verdict and not a report, so the policy reads the
 * same whoever asks it. A judge that answered with a probability at or above
 * the threshold is taken at its word. A judge that answered below the
 * threshold does not know, and not knowing is a reason to spend more: the
 * profile it named is spent one step above its own effort.
 *
 * A judge that answered with no probability has said nothing about how sure
 * it is, and a number nobody reported is not a number to threshold on, so the
 * profile is spent at its own effort.
 */
export const decide = (
  input: {
    /** The profile the judge named. */
    readonly profile: string;
    /** The probability the judge reported, when it reported one. */
    readonly confidence: number | undefined;
    /** The judge's other readings, best first. */
    readonly alternatives?: ReadonlyArray<{
      readonly profile: string;
      readonly probability: number;
    }>;
  },
  profiles: Readonly<Record<string, Profile>>,
  threshold: number = PLAY_SAFE,
): Choice | undefined => {
  const { confidence, profile } = input;
  const alternatives = (input.alternatives ?? []).filter((one) => one.profile !== profile);
  const entry = profiles[profile];
  if (entry === undefined) return { profile, effort: undefined, escalated: false, alternatives };

  const unsure = confidence !== undefined && confidence < threshold;
  const raised = unsure ? oneStepUp(entry.effort) : undefined;
  // A profile already at the ceiling has nothing to play safe with, so the
  // effort is the profile's own and nothing was raised.
  const changed = raised !== undefined && raised !== entry.effort;
  return {
    profile,
    effort: changed ? raised : undefined,
    escalated: changed,
    alternatives,
  };
};
