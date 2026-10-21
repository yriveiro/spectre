import { describe, expect, test } from "bun:test";
import {
  DEFAULT_TIMEOUT_MS,
  type JevSettings,
  jevJudge,
  QUESTION_ID,
  SYSTEMONE_ENDPOINT,
  SYSTEMONE_KEY_ENV,
} from "../../tools/definitions/routing/jev";
import type { Judge, Verdict } from "../../tools/definitions/routing/judge";

/**
 * The System One arm, proved against a fetch the arm is given.
 *
 * The tests never touch the wire: every network call here is a function the
 * arm takes, and so is the key holder. One test reads the wire itself, so the
 * shape the host's own provider speaks is what the arm sends and not a
 * summary of it.
 */

const TASK = "Rename the setting everywhere, and keep the behaviour unchanged.";
const MATCHES: Readonly<Record<string, string>> = {
  mechanical: "Use when the task changes text and alters no behaviour.",
  search: "Use when the task looks for code, and reads what it finds.",
};

const SETTINGS: JevSettings = {
  endpoint: "https://s1.test/systemone",
  model: "jev-1",
  keyEnv: "S1_KEY",
  timeout: 10,
};

const ENV = (name: string) => (name === "S1_KEY" ? "s1-key" : undefined);

/** One wire call, as the arm made it. */
type Capture = { readonly url: string; readonly init: RequestInit | undefined };

/** The fetch the arm takes: a function, and not Bun's own fetch object. */
type FakeFetch = (input: string, init?: RequestInit) => Promise<Response>;

/** A fetch that records what it was asked and hands back what the test says. */
const record = (answer: () => Response | Promise<Response>): [FakeFetch, Array<Capture>] => {
  const got: Array<Capture> = [];
  const run: FakeFetch = async (url, init) => {
    got.push({ url, init });
    return await answer();
  };
  return [run, got];
};

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

/** The answer a working endpoint reports, with one probability per label. */
const GOOD = {
  answers: {
    [QUESTION_ID]: {
      type: "choice",
      choice: "search",
      probabilities: { mechanical: 0.1, search: 0.8 },
      confidence: 0.9,
    },
  },
};

type Given = {
  /** The answer function defaults to the good one. */
  readonly answer?: () => Response | Promise<Response>;
  /** The settings on top of the working set. */
  readonly settings?: Partial<JevSettings>;
  /** The profiles on top of the two above. */
  readonly profiles?: Readonly<Record<string, string | undefined>>;
  /** The key holder. Defaults to one that knows S1_KEY. */
  readonly env?: (name: string) => string | undefined;
};

const arm = (given: Given): Judge => {
  const [fetch] = record(given.answer ?? (() => ok(GOOD)));
  return jevJudge(
    { ...SETTINGS, ...given.settings },
    // A given table replaces the base one, so a test can take the match
    // lines away. Settings merge, because one field is often the only change.
    given.profiles ?? MATCHES,
    { fetch, env: given.env ?? ENV },
  );
};

/** The reason a verdict was quiet, or the test stops here. */
const reasonOf = (verdict: Verdict): string => {
  if (verdict.kind !== "quiet") throw new Error(`expected a quiet verdict, got ${verdict.kind}`);
  return verdict.why;
};

describe("the call on the wire", () => {
  test("the arm asks the endpoint, and the body names the model, the task and the match lines", async () => {
    const [fetch, got] = record(() => ok(GOOD));
    const judge = jevJudge(SETTINGS, MATCHES, { fetch, env: ENV });
    await judge.judge(TASK);

    expect(got).toHaveLength(1);
    const seen = got[0];
    expect(seen?.url).toBe(SETTINGS.endpoint);
    expect(seen?.init?.method).toBe("POST");
    expect(seen?.init?.headers).toEqual({
      Authorization: "Bearer s1-key",
      "Content-Type": "application/json",
    });
    const body = JSON.parse(String(seen?.init?.body)) as {
      model: string;
      state: string;
      questions: Record<
        string,
        { type: string; instructions: string; criteria: Record<string, string> }
      >;
    };
    expect(body.model).toBe("jev-1");
    expect(body.state).toBe(TASK);
    expect(Object.keys(body.questions)).toEqual([QUESTION_ID]);
    const question = body.questions[QUESTION_ID];
    expect(question?.type).toBe("choice");
    expect(question?.criteria).toEqual(MATCHES);
  });

  test("the default endpoint is the one the host's own provider builds", () => {
    expect(SYSTEMONE_ENDPOINT).toBe("https://opencode.ai/inference/systemone/v1/systemone");
    expect(SYSTEMONE_KEY_ENV).toBe("OPENCODE_API_KEY");
  });
});

describe("a verdict", () => {
  test("a good answer is a profile and the probability the model gave it", async () => {
    const verdict = await arm({}).judge(TASK);
    expect(verdict).toStrictEqual({ kind: "profile", profile: "search", confidence: 0.8 });
  });

  test("the probability the model does not report stays undefined, and does not impersonate one", async () => {
    const verdict = await arm({
      answer: () =>
        ok({
          answers: { [QUESTION_ID]: { type: "choice", choice: "mechanical", confidence: 0.9 } },
        }),
    }).judge(TASK);
    expect(verdict).toStrictEqual({
      kind: "profile",
      profile: "mechanical",
      confidence: undefined,
    });
  });
});

describe("quiet verdicts, and none of them throws", () => {
  test("a config with no endpoint, no model and no key variable has nowhere to ask", async () => {
    expect(await arm({ settings: { endpoint: undefined } }).judge(TASK)).toMatchObject({
      kind: "quiet",
    });
    expect(await arm({ settings: { endpoint: "" } }).judge(TASK)).toMatchObject({ kind: "quiet" });
    expect(await arm({ settings: { model: undefined } }).judge(TASK)).toMatchObject({
      kind: "quiet",
    });
    expect(await arm({ settings: { keyEnv: undefined } }).judge(TASK)).toMatchObject({
      kind: "quiet",
    });
  });

  test("a key not in the environment is quiet, and the reason names the variable", async () => {
    const why = reasonOf(await arm({ env: () => undefined }).judge(TASK));
    expect(why).toContain('"S1_KEY"');
  });

  test("an answer past the budget is quiet, and the reason names the wait", async () => {
    const why = reasonOf(
      await arm({
        answer: async () => {
          await Bun.sleep(100);
          return ok(GOOD);
        },
        settings: { timeout: 20 },
      }).judge(TASK),
    );
    expect(why).toContain("within 20 ms");
  });

  test("a status that is not a success is quiet, and the reason names the status", async () => {
    for (const status of [401, 500, 503]) {
      const why = reasonOf(await arm({ answer: () => new Response("{}", { status }) }).judge(TASK));
      expect(why).toContain(`${status}`);
    }
  });

  test("a call that cannot be made is quiet, and the reason says why", async () => {
    const [failure] = record(async () => {
      throw new Error("the connection was cut");
    });
    const judge = jevJudge(SETTINGS, MATCHES, { fetch: failure, env: ENV });
    const why = reasonOf(await judge.judge(TASK));
    expect(why).toContain("the connection was cut");
  });

  test("an answer naming a profile the config does not have is quiet, and it names the profile", async () => {
    const why = reasonOf(
      await arm({
        answer: () =>
          ok({
            answers: { [QUESTION_ID]: { type: "choice", choice: "worker", probabilities: {} } },
          }),
      }).judge(TASK),
    );
    expect(why).toContain('"worker"');
  });

  test("no answers at all is quiet", async () => {
    expect(await arm({ answer: () => ok({ answers: {} }) }).judge(TASK)).toMatchObject({
      kind: "quiet",
    });
    expect(await arm({ answer: () => ok({}) }).judge(TASK)).toMatchObject({ kind: "quiet" });
  });

  test("an answer that is not a choice answer is quiet", async () => {
    const verdict = await arm({
      answer: () =>
        ok({ answers: { [QUESTION_ID]: { type: "score", score: 3, probabilities: {} } } }),
    }).judge(TASK);
    expect(verdict.kind).toBe("quiet");
  });

  test("an answer that is not JSON is quiet", async () => {
    const verdict = await arm({ answer: () => new Response("<html>", { status: 200 }) }).judge(
      TASK,
    );
    expect(verdict.kind).toBe("quiet");
  });

  test("profiles with no match text give the question no choices", async () => {
    const why = reasonOf(await arm({ profiles: { worker: undefined, ghost: "" } }).judge(TASK));
    expect(why).toContain("match");
  });
});

describe("the shape the arm takes", () => {
  test("it satisfies the judge interface the tool holds", () => {
    const asJudge: Judge = arm({});
    expect(asJudge.judge(TASK)).toBeInstanceOf(Promise);
  });

  test("the budget defaults, so the config may set none", () => {
    const pause = DEFAULT_TIMEOUT_MS;
    expect(pause).toBeGreaterThan(0);
  });

  test("a verdict reaches the caller through one async answer", async () => {
    const verdict = await arm({}).judge(TASK);
    const read: Verdict = verdict;
    expect(read.kind).toBe("profile");
  });
});
