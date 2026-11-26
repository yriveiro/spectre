import { Model, type Plugin } from "@opencode/plugin/effect";
import { Effect } from "effect";
import type { Judge, Verdict } from "./judge";

export type Decide = Plugin.Context["experimental"]["generate"]["decisions"];

type Decision = Effect.Success<ReturnType<Decide>>;
type Answer = Decision["answers"][number];

export const JEV_MODEL = "opencode/jev-1.13-free";

/** The budget the arm waits, when the config sets none. A delegation runs on every task, so the wait stays short. */
export const DEFAULT_TIMEOUT_MS = 2000;

export const QUESTION_ID = "profile";

/** The label of the way out of the question, and what it says. */
export const NONE_LABEL = "none";

/**
 * The criterion that lets the judge stay quiet.
 *
 * It names the requests that are not work of any kind, because a request that
 * fits no profile is not a request a profile should be chosen for.
 */
export const NONE_CRITERION =
  "the request is not work of any kind: a greeting, a repetition, a translation, a question about the session, or an answer to a yes-or-no question";

/** The instructions the question carries. */
export const QUESTION_INSTRUCTIONS =
  "One task statement follows. Name the profile the task belongs to. Answer with one profile name.";

export type JevSettings = {
  readonly model?: string | undefined;
  /** The budget in milliseconds. */
  readonly timeout?: number | undefined;
};

export const judgeRef = (model: string | undefined): string => {
  const named = model === undefined || model === "" ? JEV_MODEL : model;
  return named.includes("/") ? named : `opencode/${named}`;
};

const quiet = (why: string): Verdict => ({ kind: "quiet", why });

type Ref =
  | { readonly kind: "parsed"; readonly model: Model.Ref; readonly text: string }
  | { readonly kind: "refused"; readonly why: string };

const parseRef = (text: string): Ref => {
  try {
    return { kind: "parsed", model: Model.Ref.parse(text), text };
  } catch (error) {
    return {
      kind: "refused",
      why: `The judge model "${text}" is not a model ref: ${textOf(error)}`,
    };
  }
};

const textOf = (error: unknown): string =>
  typeof error === "object" &&
  error !== null &&
  "message" in error &&
  typeof error.message === "string"
    ? error.message
    : String(error);

const ranked = (
  probabilities: ReadonlyArray<{ readonly value: string | boolean; readonly probability: number }>,
  criteria: Readonly<Record<string, string>>,
): ReadonlyArray<{ readonly profile: string; readonly probability: number }> =>
  probabilities
    .flatMap((one) =>
      typeof one.value === "string" && one.value in criteria && one.probability > 0
        ? [{ profile: one.value, probability: one.probability }]
        : [],
    )
    .toSorted((one, two) => two.probability - one.probability);

const read = (answer: Answer | undefined, criteria: Readonly<Record<string, string>>): Verdict => {
  if (answer === undefined) return quiet(`The host returned no answer for "${QUESTION_ID}".`);
  if (answer.type === "error") return quiet(`The judge gave no answer: ${answer.reason}.`);
  if (answer.type !== "choice")
    return quiet("The answer is not a choice answer, so the arm cannot read it.");
  const choice = answer.choice;
  if (typeof choice !== "string") return quiet("The answer names no profile.");
  if (choice === NONE_LABEL) return quiet("The judge says no profile fits this task.");
  if (!(choice in criteria))
    return quiet(`The answer names "${choice}", and the config has no profile with that name.`);
  return {
    kind: "profile",
    profile: choice,
    confidence: answer.probabilities.find((one) => one.value === choice)?.probability,
    alternatives: ranked(answer.probabilities, criteria),
  };
};

export const jevJudge = (
  settings: JevSettings,
  profiles: Readonly<Record<string, string | undefined>>,
  decide: Decide,
): Judge => {
  const budget = settings.timeout ?? DEFAULT_TIMEOUT_MS;

  const criteria: Record<string, string> = {};
  for (const [name, match] of Object.entries(profiles)) {
    if (match !== undefined && match !== "") criteria[name] = match;
  }
  // The question carries a way out, and it is not decoration. A choice
  // question with a closed set of values always answers with one of them, so
  // without this the judge fires on every request, including the ones that
  // fit no profile. Measured on the routing corpus: without this criterion
  // the judge named a profile for all eight negative rows, and with it, all
  // eight say none and no judged row changes its answer.
  if (Object.keys(criteria).length > 0) criteria[NONE_LABEL] = NONE_CRITERION;

  const ref = parseRef(judgeRef(settings.model));
  const refused =
    Object.keys(criteria).length === 0
      ? quiet('The profiles carry no "match" text, so the question has no choices.')
      : undefined;

  const judge = (task: string): Effect.Effect<Verdict> => {
    if (refused !== undefined) return Effect.succeed(refused);
    if (ref.kind === "refused") return Effect.succeed(quiet(ref.why));
    return decide({
      model: ref.model,
      input: [{ type: "text", text: task }],
      questions: [
        {
          type: "choice",
          name: QUESTION_ID,
          instructions: QUESTION_INSTRUCTIONS,
          choices: Object.entries(criteria).map(([value, description]) => ({ value, description })),
        },
      ],
    }).pipe(
      Effect.map((decision) =>
        read(
          decision.answers.find((one) => one.name === QUESTION_ID),
          criteria,
        ),
      ),
      Effect.catch((error) =>
        Effect.succeed(quiet(`The host could not ask ${ref.text}: ${textOf(error)}`)),
      ),
      Effect.timeoutOrElse({
        duration: budget,
        orElse: () => Effect.succeed(quiet(`The judge made no answer within ${budget} ms.`)),
      }),
    );
  };

  return { judge };
};
