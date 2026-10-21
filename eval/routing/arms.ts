/**
 * The arms: the ways a profile is chosen for a task.
 *
 * The lexical arm wraps the product's own ranking, so this harness measures the
 * code the tool runs and not a copy of it. The model arm asks a model to name
 * the profile, which is what a session does today when the tool hands back the
 * table and the model picks.
 */
import { type Description, rank } from "../../tools/definitions/routing";

export type { Description };

/** What an arm said about one task. */
export type Prediction = {
  readonly prompt: string;
  /** The profile it named, or `none` when it stayed quiet. */
  readonly got: string;
};

/** The answer for a prompt that matched nothing. */
const QUIET = "none";

/**
 * The lexical arm. It ranks the descriptions against each prompt and takes the
 * top one, or `none` when nothing scores.
 */
export const lexical = (
  descriptions: ReadonlyArray<Description>,
  prompts: ReadonlyArray<string>,
): ReadonlyArray<Prediction> =>
  prompts.map((prompt) => ({ prompt, got: rank(descriptions, prompt) ?? QUIET }));

/**
 * The model arm's question. The model is asked to name a profile, or `none`,
 * and to do nothing else.
 */
export const ASK =
  "Which one of the available profiles should handle the request below, or the word none if " +
  "none of them applies? Reply with the profile name and nothing else. Do not do the work.";

/** The full question for one prompt: the profiles, the ask, the request. */
const question = (descriptions: ReadonlyArray<Description>, prompt: string): string => {
  const lines = descriptions.map((one) => `- ${one.profile}: ${one.text}`).join("\n");
  return `${ASK}\n\n${lines}\n\nRequest: ${prompt}`;
};

/**
 * Read a profile name out of a reply. The reply is a bare name, so the first
 * word carries it. Quotes and trailing punctuation fall away. A name the arm
 * was not offered is not a profile, so it reads as `none`.
 */
const read = (reply: string, offered: ReadonlyMap<string, string>): string => {
  const first =
    reply
      .trim()
      .replace(/^["'`]+|["'`]+$/g, "")
      .split(/\s+/, 1)[0] ?? "";
  const name = first.replace(/^["'`(]+|["'`).,!?;:]+$/g, "").toLowerCase();
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
  const offered = new Map(descriptions.map((one) => [one.profile.toLowerCase(), one.profile]));
  const replies = await Promise.all(
    prompts.map((prompt) => generate(question(descriptions, prompt))),
  );
  return prompts.map((prompt, i) => ({
    prompt,
    got: read(replies[i] ?? "", offered),
  }));
};

/**
 * The System One arm.
 *
 * It asks the judge the product ships, so the measurement is of the arm the
 * router would use and not of a copy of it. It needs the key in the
 * environment, and it says so rather than failing quietly.
 */
export const jev = async (
  judge: {
    readonly judge: (
      task: string,
    ) => Promise<
      | {
          readonly kind: "profile";
          readonly profile: string;
          readonly confidence: number | undefined;
        }
      | { readonly kind: "quiet"; readonly why: string }
    >;
  },
  prompts: ReadonlyArray<string>,
): Promise<ReadonlyArray<Prediction>> => {
  const out: Array<Prediction> = [];
  for (const prompt of prompts) {
    const verdict = await judge.judge(prompt);
    out.push({
      prompt,
      got: verdict.kind === "profile" ? verdict.profile : "none",
    });
  }
  return out;
};
