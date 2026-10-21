/**
 * The arms: the ways a profile is chosen for a task.
 *
 * A lexical arm ranks the routing surface with BM25. A model arm asks a model
 * to name the profile, which is what a session does today when the tool hands
 * back the table and the model picks.
 */

export type Description = {
  readonly profile: string;
  /** The text the arm ranks, the `match` line or the `why` line. */
  readonly text: string;
};

/** What an arm said about one task. */
export type Prediction = {
  readonly prompt: string;
  /** The profile it named, or `none` when it stayed quiet. */
  readonly got: string;
};

/** The answer for a prompt that matched nothing. */
const QUIET = "none";

/** The BM25 saturation point. A plain default. */
const K1 = 1.2;

/** The BM25 length weight. A plain default. */
const B = 0.75;

// This arm ranks with its own BM25 and does not borrow ripwire. Ripwire ranks
// skill descriptions in a directory of skills. It is the better matcher there.
// Here the corpus holds seven short descriptions, not a catalogue of skills.
// Ripwire's own catalogue would rank alongside them and win rows that have
// nothing to do with routing. A BM25 over the given descriptions is short and
// deterministic, and it is the thing under test.

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
 * The lexical arm. It ranks the descriptions against each prompt and takes the
 * top one, or `none` when nothing scores.
 */
export const lexical = (
  descriptions: ReadonlyArray<Description>,
  prompts: ReadonlyArray<string>,
): ReadonlyArray<Prediction> => {
  const docs = descriptions.map((one) => terms(one.text));
  const counts = docs.map(termFreq);
  const shared = docFreq(docs);
  const total = docs.length;
  const mean =
    total === 0 ? 0 : docs.reduce((sum, doc) => sum + doc.length, 0) / total;

  return prompts.map((prompt) => {
    const query = new Set(terms(prompt));
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
      // A strict win keeps the earlier description on a tie, so the order of
      // the descriptions never decides except between equal scores.
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return { prompt, got: best === -1 ? QUIET : (descriptions[best]?.profile ?? QUIET) };
  });
};

/**
 * The model arm's question. The model is asked to name a profile, or `none`,
 * and to do nothing else.
 */
export const ASK =
  "Which one of the available profiles should handle the request below, or the word none if " +
  "none of them applies? Reply with the profile name and nothing else. Do not do the work.";

/** The full question for one prompt: the profiles, the ask, the request. */
const question = (
  descriptions: ReadonlyArray<Description>,
  prompt: string,
): string => {
  const lines = descriptions.map((one) => `- ${one.profile}: ${one.text}`).join("\n");
  return `${ASK}\n\n${lines}\n\nRequest: ${prompt}`;
};

/**
 * Read a profile name out of a reply. The reply is a bare name, so the first
 * word carries it. Quotes and trailing punctuation fall away. A name the arm
 * was not offered is not a profile, so it reads as `none`.
 */
const read = (reply: string, offered: ReadonlyMap<string, string>): string => {
  const first = reply.trim().replace(/^["'`]+|["'`]+$/g, "").split(/\s+/, 1)[0] ?? "";
  const name = first
    .replace(/^["'`(]+|["'`).,!?;:]+$/g, "")
    .toLowerCase();
  if (name === QUIET || name === "") return QUIET;
  return offered.get(name) ?? QUIET;
};

/**
 * The model arm. It asks a model for each prompt and reads the profile name
 * out of the reply.
 */
export const ask = async (
  generate: (prompt: string) => Promise<string>,
  descriptions: ReadonlyArray<Description>,
  prompts: ReadonlyArray<string>,
): Promise<ReadonlyArray<Prediction>> => {
  const offered = new Map(
    descriptions.map((one) => [one.profile.toLowerCase(), one.profile]),
  );
  const replies = await Promise.all(
    prompts.map((prompt) => generate(question(descriptions, prompt))),
  );
  return prompts.map((prompt, i) => ({
    prompt,
    got: read(replies[i] ?? "", offered),
  }));
};
