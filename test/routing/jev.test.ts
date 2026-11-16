import { describe, expect, test } from "bun:test";
import { Model, Provider } from "@opencode/plugin/effect";
import { Effect } from "effect";
import {
  CONSOLE_ENDPOINT,
  type Decide,
  JEV_MODEL,
  type JevSettings,
  jevJudge,
  judgeRef,
  NONE_CRITERION,
  NONE_LABEL,
  QUESTION_ID,
  QUESTION_INSTRUCTIONS,
} from "../../tools/definitions/routing/jev";
import type { Judge, Verdict } from "../../tools/definitions/routing/judge";

const TASK = "Rename the setting everywhere, and keep the behaviour unchanged.";
const MATCHES: Readonly<Record<string, string>> = {
  mechanical: "Use when the task changes text and alters no behaviour.",
  search: "Use when the task looks for code, and reads what it finds.",
};

const SETTINGS: JevSettings = { model: "acme/jev-1", timeout: 50 };

type Request = Parameters<Decide>[0];
type Decision = Effect.Success<ReturnType<Decide>>;

const GOOD: Decision = {
  answers: [
    {
      type: "choice",
      name: QUESTION_ID,
      choice: "search",
      probabilities: [
        { value: "mechanical", probability: 0.1 },
        { value: "search", probability: 0.8 },
        { value: NONE_LABEL, probability: 0.1 },
      ],
      confidence: 0.9,
    },
  ],
};

const record = (answer: () => ReturnType<Decide>): [Decide, Array<Request>] => {
  const got: Array<Request> = [];
  const decide: Decide = (input) => {
    got.push(input);
    return answer();
  };
  return [decide, got];
};

const arm = (given: {
  readonly answer?: () => ReturnType<Decide>;
  readonly settings?: Partial<JevSettings>;
  readonly profiles?: Readonly<Record<string, string | undefined>>;
}): Judge => {
  const [decide] = record(given.answer ?? (() => Effect.succeed(GOOD)));
  return jevJudge({ ...SETTINGS, ...given.settings }, given.profiles ?? MATCHES, decide);
};

const reasonOf = (verdict: Verdict): string => {
  if (verdict.kind !== "quiet") throw new Error(`expected a quiet verdict, got ${verdict.kind}`);
  return verdict.why;
};

describe("the question the host is asked", () => {
  test("one choice question names the model, carries the task, and offers each match line plus the way out", async () => {
    const [decide, got] = record(() => Effect.succeed(GOOD));
    await jevJudge(SETTINGS, MATCHES, decide).judge(TASK).pipe(Effect.runPromise);

    expect(got).toEqual([
      {
        model: Model.Ref.make({ providerID: Provider.ID.make("acme"), id: Model.ID.make("jev-1") }),
        input: [{ type: "text", text: TASK }],
        questions: [
          {
            type: "choice",
            name: QUESTION_ID,
            instructions: QUESTION_INSTRUCTIONS,
            choices: [
              { value: "mechanical", description: MATCHES.mechanical },
              { value: "search", description: MATCHES.search },
              { value: NONE_LABEL, description: NONE_CRITERION },
            ],
          },
        ],
      },
    ]);
  });

  test("a bare id names the opencode provider's model, and no model names the default", () => {
    expect(judgeRef("jev-1.13-free")).toBe("opencode/jev-1.13-free");
    expect(judgeRef("acme/jev-1")).toBe("acme/jev-1");
    expect(judgeRef(undefined)).toBe(JEV_MODEL);
    expect(JEV_MODEL).toBe("opencode/jev-1.13-free");
  });

  test("no question is asked when no profile carries a match line", async () => {
    const [decide, got] = record(() => Effect.succeed(GOOD));
    const why = reasonOf(
      await jevJudge(SETTINGS, { worker: undefined }, decide).judge(TASK).pipe(Effect.runPromise),
    );
    expect(why).toContain("match");
    expect(got).toHaveLength(0);
  });
});

describe("a verdict", () => {
  test("a good answer is a profile, the probability the model gave it, and the runners-up best first", async () => {
    expect(await arm({}).judge(TASK).pipe(Effect.runPromise)).toStrictEqual({
      kind: "profile",
      profile: "search",
      confidence: 0.8,
      alternatives: [
        { profile: "search", probability: 0.8 },
        { profile: "mechanical", probability: 0.1 },
        { profile: NONE_LABEL, probability: 0.1 },
      ],
    });
  });

  test("a choice the model gave no probability has no confidence", async () => {
    const verdict = await arm({
      answer: () =>
        Effect.succeed({
          answers: [
            {
              type: "choice",
              name: QUESTION_ID,
              choice: "mechanical",
              probabilities: [],
              confidence: 0.9,
            },
          ],
        }),
    })
      .judge(TASK)
      .pipe(Effect.runPromise);
    expect(verdict).toStrictEqual({
      kind: "profile",
      profile: "mechanical",
      confidence: undefined,
      alternatives: [],
    });
  });
});

describe("quiet verdicts, and none of them throws", () => {
  test("the way out is quiet", async () => {
    const why = reasonOf(
      await arm({
        answer: () =>
          Effect.succeed({
            answers: [
              {
                type: "choice",
                name: QUESTION_ID,
                choice: NONE_LABEL,
                probabilities: [],
                confidence: 1,
              },
            ],
          }),
      })
        .judge(TASK)
        .pipe(Effect.runPromise),
    );
    expect(why).toContain("no profile fits");
  });

  test("a host failure is quiet, and the reason carries the host's message", async () => {
    const why = reasonOf(
      await arm({ answer: () => Effect.fail({ message: "Model not found: acme/jev-1" }) })
        .judge(TASK)
        .pipe(Effect.runPromise),
    );
    expect(why).toContain("Model not found: acme/jev-1");
  });

  test("an answer past the budget is quiet, and the reason names the wait", async () => {
    const why = reasonOf(
      await arm({
        answer: () => Effect.succeed(GOOD).pipe(Effect.delay("200 millis")),
        settings: { timeout: 20 },
      })
        .judge(TASK)
        .pipe(Effect.runPromise),
    );
    expect(why).toContain("within 20 ms");
  });

  test("a legacy endpoint other than the Console is quiet before the host is asked, and names it", async () => {
    const [decide, got] = record(() => Effect.succeed(GOOD));
    const judge = jevJudge({ ...SETTINGS, endpoint: "https://openrouter.ai/x" }, MATCHES, decide);
    const why = reasonOf(await judge.judge(TASK).pipe(Effect.runPromise));
    expect(why).toContain("https://openrouter.ai/x");
    expect(got).toHaveLength(0);
  });

  test("the Console endpoint from an older file is the host's own call", async () => {
    const [decide, got] = record(() => Effect.succeed(GOOD));
    const judge = jevJudge({ ...SETTINGS, endpoint: CONSOLE_ENDPOINT }, MATCHES, decide);
    expect((await judge.judge(TASK).pipe(Effect.runPromise)).kind).toBe("profile");
    expect(got).toHaveLength(1);
  });

  test("a model that is not a ref is quiet before the host is asked", async () => {
    const [decide, got] = record(() => Effect.succeed(GOOD));
    const why = reasonOf(
      await jevJudge({ model: "acme/" }, MATCHES, decide).judge(TASK).pipe(Effect.runPromise),
    );
    expect(why).toContain('"acme/"');
    expect(got).toHaveLength(0);
  });

  test("an answer naming a profile the config does not have is quiet, and it names the profile", async () => {
    const why = reasonOf(
      await arm({
        answer: () =>
          Effect.succeed({
            answers: [
              {
                type: "choice",
                name: QUESTION_ID,
                choice: "worker",
                probabilities: [],
                confidence: 1,
              },
            ],
          }),
      })
        .judge(TASK)
        .pipe(Effect.runPromise),
    );
    expect(why).toContain('"worker"');
  });

  test("no answer for the question is quiet", async () => {
    const why = reasonOf(
      await arm({ answer: () => Effect.succeed({ answers: [] }) })
        .judge(TASK)
        .pipe(Effect.runPromise),
    );
    expect(why).toContain(`"${QUESTION_ID}"`);
  });

  test("an error answer is quiet, and the reason carries the host's reason", async () => {
    const why = reasonOf(
      await arm({
        answer: () =>
          Effect.succeed({ answers: [{ type: "error", name: QUESTION_ID, reason: "refusal" }] }),
      })
        .judge(TASK)
        .pipe(Effect.runPromise),
    );
    expect(why).toContain("refusal");
  });

  test("an answer that is not a choice answer is quiet", async () => {
    const verdict = await arm({
      answer: () =>
        Effect.succeed({
          answers: [
            { type: "score", name: QUESTION_ID, score: 1, probabilities: [], confidence: 1 },
          ],
        }),
    })
      .judge(TASK)
      .pipe(Effect.runPromise);
    expect(verdict.kind).toBe("quiet");
  });
});

describe("the budget", () => {
  test("a config that sets none still waits for the answer", async () => {
    const verdict = await arm({ settings: { timeout: undefined } })
      .judge(TASK)
      .pipe(Effect.runPromise);
    expect(verdict.kind).toBe("profile");
  });
});
