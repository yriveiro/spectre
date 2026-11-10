import type { Profile } from "./types";

/**
 * The judge: which profile a task belongs to.
 *
 * The routing path has two steps. The judge answers the first one, which
 * profile, and never the second one, which model. It names a profile from the
 * list the user wrote, so the resolver still picks the model and the allowlist
 * order still decides which one. A judge that named a model would be a second
 * resolver, and two resolvers disagree.
 *
 * A judge that cannot answer says why. It does not guess, because the caller
 * then falls back to the agent's own reading of the `match` lines, and a guess
 * hides that fallback.
 *
 * @see features/routing.md
 */

/**
 * The answer: a profile and its confidence, or the reason there is no profile.
 *
 * The confidence is `undefined` when the arm has none to give. The lexical arm
 * has a score and not a probability, and a score dressed up as a probability is
 * a number the policy would threshold on wrongly.
 */
export type Verdict =
  | {
      readonly kind: "profile";
      readonly profile: string;
      readonly confidence: number | undefined;
      /**
       * The other profiles the judge gave a probability to, in the order it
       * ranked them. They are the information a policy needs when the top
       * answer is unsure: the runner-up is not a mistake, it is the second
       * reading of the same task.
       */
      readonly alternatives?: ReadonlyArray<{
        readonly profile: string;
        readonly probability: number;
      }>;
    }
  | { readonly kind: "quiet"; readonly why: string };

/**
 * A judge as the tool holds it. The tool holds `undefined` when the config asks
 * for no judge, and that is the whole of the "no judge" case: the tool does not
 * ask, and the agent picks the profile itself.
 */
export type Judge = {
  readonly judge: (task: string) => Promise<Verdict>;
};

/** One profile, and the text an arm ranks it by: its `match` line. */
export type Description = {
  readonly profile: string;
  /** The text the arm ranks, the `match` line. */
  readonly text: string;
};

/** The BM25 saturation point. A plain default. */
const K1 = 1.2;

/** The BM25 length weight. A plain default. */
const B = 0.75;

// This ranking has its own BM25 and does not borrow ripwire. Ripwire ranks
// skill descriptions in a directory of skills, and it is the better matcher
// there. Here the surface holds the profiles of one config, and ripwire's own
// catalogue would rank alongside them and win rows that have nothing to do with
// routing. A BM25 over the given descriptions is short and deterministic, and
// it is the thing under test.

/** Split text into lowercase terms. */
const terms = (text: string): Array<string> =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 0);

/** Count each term once per document. */
const docFreq = (docs: ReadonlyArray<ReadonlyArray<string>>): Map<string, number> => {
  const freq = new Map<string, number>();
  for (const doc of docs)
    for (const term of new Set(doc)) freq.set(term, (freq.get(term) ?? 0) + 1);
  return freq;
};

/** Count each term in one document. */
const termFreq = (doc: ReadonlyArray<string>): Map<string, number> => {
  const freq = new Map<string, number>();
  for (const term of doc) freq.set(term, (freq.get(term) ?? 0) + 1);
  return freq;
};

/**
 * The description that ranks highest for the task, or `undefined` when nothing
 * scores. A task that shares no term with any description fits none of them. It
 * names no profile, and that is not the same as a score of zero.
 *
 * A tie keeps the earlier description, so the order of the descriptions decides
 * only between equal scores.
 */
export const rank = (
  descriptions: ReadonlyArray<Description>,
  task: string,
): string | undefined => {
  const docs = descriptions.map((one) => terms(one.text));
  const counts = docs.map(termFreq);
  const shared = docFreq(docs);
  const total = docs.length;
  const mean = total === 0 ? 0 : docs.reduce((sum, doc) => sum + doc.length, 0) / total;

  const query = new Set(terms(task));
  let best = -1;
  let bestScore = 0;
  for (let i = 0; i < total; i++) {
    const doc = docs[i] ?? [];
    const freq = counts[i] ?? new Map<string, number>();
    let score = 0;
    for (const term of query) {
      const hit = freq.get(term) ?? 0;
      if (hit === 0) continue;
      const found = shared.get(term) ?? 0;
      const idf = Math.log(1 + (total - found + 0.5) / (found + 0.5));
      const norm = mean === 0 ? 1 : 1 - B + (B * doc.length) / mean;
      score += (idf * hit * (K1 + 1)) / (hit + K1 * norm);
    }
    // A strict win keeps the earlier description on a tie, so the order of the
    // descriptions never decides except between equal scores.
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best === -1 ? undefined : descriptions[best]?.profile;
};

/**
 * The routing surface: the profiles that carry a `match` line, in the order the
 * config lists them. A profile with no `match` line cannot be picked by reading
 * the surface, so no arm is offered it.
 */
export const surface = (profiles: Readonly<Record<string, Profile>>): ReadonlyArray<Description> =>
  Object.entries(profiles).flatMap(([profile, entry]) =>
    entry.match === undefined ? [] : [{ profile, text: entry.match }],
  );

/**
 * The lexical arm: BM25 over the `match` lines. It names the profile that ranks
 * highest, and it stays quiet when nothing scores.
 *
 * Its confidence is `undefined`. The arm has a score, and a score is not a
 * probability, so it reports no number rather than a number the policy would
 * read as calibrated.
 */
export const lexicalJudge = (profiles: Readonly<Record<string, Profile>>): Judge => ({
  judge: async (task) => {
    const described = surface(profiles);
    if (described.length === 0)
      return { kind: "quiet", why: "no profile has a match line, so no profile can be ranked" };
    const profile = rank(described, task);
    if (profile === undefined)
      return { kind: "quiet", why: "the task shares no term with a profile's match line" };
    // A lexical arm ranks, so it has one answer and no distribution. The
    // alternatives are the ones it did not choose, and it has no probability
    // for any of them, so the list is empty.
    return { kind: "profile", profile, confidence: undefined, alternatives: [] };
  },
});
