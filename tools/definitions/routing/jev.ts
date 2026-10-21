import type { Judge, Verdict } from "./judge";

/**
 * The System One arm of the judge.
 *
 * The arm sends the task and the profiles' `match` lines to a System One
 * endpoint, and it reads back the profile the model picked and the probability
 * it gave that profile. The shapes come from the host's own provider, read at
 * the tag `v2.1.1`:
 *
 * - the endpoint is `SYSTEMONE_BASE_URL` and the model route appends
 *   `/systemone` to it (`packages/ai/src/providers/opencode.ts`,
 *   `packages/ai/src/experimental/system-one.ts`);
 * - the request is `{ model, state, questions }`, and the question is a choice
 *   one: `{ type: "choice", instructions, criteria }`, where `criteria` maps
 *   each label to the text that describes it
 *   (`packages/ai/src/experimental/evaluation.ts`, `ChoiceQuestion`);
 * - the answer is `{ answers }`, and one answer is
 *   `{ type: "choice", choice, probabilities, confidence }`, where
 *   `probabilities` carries one number per label (`ChoiceAnswer`).
 *
 * The key is the variable the host's own provider names: the config says
 * which one, and the default is `SYSTEMONE_KEY_ENV`
 * (`packages/ai/src/providers/opencode.ts`, `AuthOptions.bearer(input,
 * "OPENCODE_API_KEY")`).
 *
 * Every failure is a quiet verdict, and no failure throws, because the arm
 * sits on the delegation path. A judge that cannot answer leaves the task
 * where it is: the agent reads the `match` lines and picks the profile, which
 * is the workflow without a judge. The rule the design turns on holds here
 * too: the arm names a profile and a probability, and it never names a model.
 */

/** The base the host's own provider configures. */
export const SYSTEMONE_BASE_URL = "https://opencode.ai/inference/systemone/v1";

/** The base plus the route the System One model builds. */
export const SYSTEMONE_ENDPOINT = `${SYSTEMONE_BASE_URL}/systemone`;

/** The env variable the host's own provider names for the key. */
export const SYSTEMONE_KEY_ENV = "OPENCODE_API_KEY";

/** The budget the arm waits, when the config sets none. A delegation runs on every task, so the wait stays short. */
export const DEFAULT_TIMEOUT_MS = 2000;

/** The id the arm writes its one question under, and reads the answer from. */
export const QUESTION_ID = "profile";

/** The instructions the question carries. */
export const QUESTION_INSTRUCTIONS =
  "One task statement follows. Name the profile the task belongs to. Answer with one profile name.";

/**
 * The judge settings the config carries.
 *
 * An omitted endpoint, model or key variable leaves no way to send one
 * question, so the arm answers quiet. There is no endpoint default on
 * purpose: the config states where to ask, and the starter set writes it.
 */
export type JevSettings = {
  /** The URL to ask. An empty one, or an absent one, is nowhere to ask. */
  readonly endpoint?: string | undefined;
  /** The System One model id, and it goes into the request. */
  readonly model?: string | undefined;
  /** The env variable that carries the key. */
  readonly keyEnv?: string | undefined;
  /** The budget in milliseconds. */
  readonly timeout?: number | undefined;
};

/**
 * What the arm reads from outside its own logic.
 *
 * The `fetch` is a function the arm is given, the same way the page's dialog
 * is a function it is given, and the tests hand in a fake. The tests also hand
 * in the key holder, so no test reads a developer's own environment.
 *
 * A bare function is the type, and not `typeof fetch`: Bun's own fetch object
 * carries a `preconnect` member a test's fake does not, and the arm asks for
 * the call and not for the member.
 */
export type JevDeps = {
  readonly fetch: (input: string, init?: RequestInit) => Promise<Response>;
  readonly env: (name: string) => string | undefined;
};

const defaultDeps = (): JevDeps => ({
  fetch,
  env: (name: string) => Bun.env[name],
});

/**
 * The deadline, distinct in type from any failure the fetch reports, so the
 * catch tells a stop the arm made from a stop the network made.
 */
class Deadline extends Error {
  constructor(readonly milliseconds: number) {
    super(`The judge made no answer within ${milliseconds} ms.`);
    this.name = "JevDeadline";
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const quiet = (why: string): Verdict => ({ kind: "quiet", why });

const textOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** One answer as the wire carries it, before the arm trusts any of it. */
type WireAnswer = Record<string, unknown>;

/**
 * The probability the model reported for its own choice, or `undefined` when
 * `probabilities` does not report it. A number the wire cannot name is not a
 * probability the policy can threshold on, so `undefined` stands.
 */
const given = (answer: WireAnswer, choice: string): number | undefined => {
  const table = answer.probabilities;
  if (!isRecord(table)) return undefined;
  const value = table[choice];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

/**
 * The judge the config asks for.
 *
 * A task arrives, the arm asks one choice question, and the verdict carries
 * the profile and the probability. A profile name on the config is the label
 * of a criterion, so the answer's choice reads as a profile name without a
 * second map.
 */
export const jevJudge = (
  settings: JevSettings,
  profiles: Readonly<Record<string, string | undefined>>,
  deps?: Partial<JevDeps>,
): Judge => {
  const io: JevDeps = { ...defaultDeps(), ...deps };
  const budget = settings.timeout === undefined ? DEFAULT_TIMEOUT_MS : settings.timeout;

  const judge = async (task: string): Promise<Verdict> => {
    if (!settings.endpoint)
      return quiet("The judge config names no endpoint, so the question has nowhere to go.");
    if (!settings.model)
      return quiet("The judge config names no model, so there is nothing to ask.");
    if (!settings.keyEnv)
      return quiet(`The judge config names no key variable, so the request carries no key.`);
    const key = io.env(settings.keyEnv);
    if (!key)
      return quiet(`The key "${settings.keyEnv}" is not set, so the request carries no key.`);

    const criteria: Record<string, string> = {};
    for (const [name, match] of Object.entries(profiles)) {
      // Only a profile whose `match` line says something is a choice the
      // question can describe. The tool passes the `surface` of the profiles,
      // which filters the same way.
      if (match !== undefined && match !== "") criteria[name] = match;
    }
    if (Object.keys(criteria).length === 0)
      return quiet('The profiles carry no "match" text, so the question has no choices.');

    const body = JSON.stringify({
      model: settings.model,
      state: task,
      questions: {
        [QUESTION_ID]: {
          type: "choice",
          instructions: QUESTION_INSTRUCTIONS,
          criteria,
        },
      },
    });

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Deadline(budget));
      }, budget);
    });

    let response: Response;
    try {
      response = await Promise.race([
        io.fetch(settings.endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body,
          signal: controller.signal,
        }),
        deadline,
      ]);
    } catch (error) {
      clearTimeout(timer);
      return quiet(
        error instanceof Deadline
          ? error.message
          : `The call to the endpoint failed: ${textOf(error)}`,
      );
    }
    // The answer is in hand, so the budget does not wait and the abort never
    // fires on a call that is over.
    clearTimeout(timer);

    if (!response.ok)
      return quiet(
        `The endpoint answered with status ${response.status}, and the judge needs a success.`,
      );

    let wire: unknown;
    try {
      wire = JSON.parse(await response.text());
    } catch (error) {
      return quiet(`The answer could not be read as JSON: ${textOf(error)}`);
    }

    const answers = isRecord(wire) ? wire.answers : undefined;
    if (!isRecord(answers) || Object.keys(answers).length === 0)
      return quiet("The endpoint returned no answers.");

    const raw = answers[QUESTION_ID];
    if (!isRecord(raw)) return quiet(`The endpoint returned no answer for "${QUESTION_ID}".`);
    if (raw.type !== "choice")
      return quiet("The answer is not a choice answer, so the arm cannot read it.");
    if (typeof raw.choice !== "string") return quiet("The answer names no profile.");

    const choice = raw.choice;
    if (!(choice in criteria))
      return quiet(`The answer names "${choice}", and the config has no profile with that name.`);
    return { kind: "profile", profile: choice, confidence: given(raw, choice) };
  };

  return { judge };
};
