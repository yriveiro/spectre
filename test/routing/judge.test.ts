import { describe, expect, test } from "bun:test";
import { lexicalJudge, rank, surface, type Verdict } from "../../tools/definitions/routing/judge";
import type { Profile } from "../../tools/definitions/routing/types";

/**
 * A profile table from the `match` lines, the way a config declares one. A
 * `null` is a profile with no `match` line, and it is offered to no arm.
 */
const table = (matches: Readonly<Record<string, string | null>>): Record<string, Profile> =>
  Object.fromEntries(
    Object.entries(matches).map(([name, match]) => [name, match === null ? {} : { match }]),
  );

const MECHANICAL = "Use when the task is small and mechanical, like a typo fix or a rename";
const THINKING = "Use when the task needs deep design thought across many files";

const described: Record<string, Profile> = table({
  mechanical: MECHANICAL,
  thinking: THINKING,
});

/** The verdict for a task, from the lexical arm. */
const verdict = (task: string, profiles: Record<string, Profile> = described): Promise<Verdict> =>
  lexicalJudge(profiles).judge(task);

describe("the lexical arm", () => {
  test("it names the profile the task fits", async () => {
    const got = await verdict("Fix a typo in a comment");
    expect(got).toEqual({ kind: "profile", profile: "mechanical", confidence: undefined });
  });

  test("it names the other profile when the task fits the other one", async () => {
    const got = await verdict("This needs deep design thought across files");
    expect(got).toEqual({ kind: "profile", profile: "thinking", confidence: undefined });
  });

  test("it stays quiet when no profile fits", async () => {
    const got = await verdict("Zebra xylophone quantum harvest");
    expect(got.kind).toBe("quiet");
    if (got.kind === "quiet")
      expect(got.why).toBe("the task shares no term with a profile's match line");
  });

  test("the confidence is undefined, because a score is not a probability", async () => {
    const got = await verdict("Fix a typo in a comment");
    expect(got.kind).toBe("profile");
    // `toBeUndefined` and not `toBeFalsy`: a zero would be a number the policy
    // would threshold on, so an absent number has to be the absent value.
    if (got.kind === "profile") expect(got.confidence).toBeUndefined();
  });

  test("a tie keeps the profile the config listed first", async () => {
    const tied = table({ one: THINKING, two: THINKING });
    const got = await verdict("Deep design thought across files", tied);
    expect(got).toEqual({ kind: "profile", profile: "one", confidence: undefined });
  });

  test("the reverse order picks the other profile of the tie", async () => {
    const tied = table({ two: THINKING, one: THINKING });
    const got = await verdict("Deep design thought across files", tied);
    expect(got).toEqual({ kind: "profile", profile: "two", confidence: undefined });
  });

  test("a profile with no match line is offered to no arm", async () => {
    const withPinned = table({ pinned: null, mechanical: MECHANICAL });
    expect(surface(withPinned)).toEqual([{ profile: "mechanical", text: MECHANICAL }]);
    const got = await verdict("Fix a typo in a comment", withPinned);
    expect(got).toEqual({ kind: "profile", profile: "mechanical", confidence: undefined });
  });

  test("it stays quiet when no profile has a match line", async () => {
    const got = await verdict("Fix a typo in a comment", table({ pinned: null }));
    expect(got.kind).toBe("quiet");
    if (got.kind === "quiet")
      expect(got.why).toBe("no profile has a match line, so no profile can be ranked");
  });

  test("it answers the same way twice for the same task", async () => {
    const first = await verdict("Deep design thought across many files");
    const second = await verdict("Deep design thought across many files");
    expect(second).toEqual(first);
  });

  test("the answer carries the profile and no model", async () => {
    const got = await verdict("Fix a typo in a comment");
    // The design rule: the judge never names a model. The type says so, and this
    // says a later arm cannot add one to the object without a test going red.
    expect(Object.keys(got).sort()).toEqual(["confidence", "kind", "profile"]);
  });
});

describe("rank", () => {
  test("it names the description that shares the most terms", () => {
    expect(rank(surface(described), "Fix a typo in a comment")).toBe("mechanical");
  });

  test("it returns undefined when the task shares no term", () => {
    expect(rank(surface(described), "Zebra xylophone quantum harvest")).toBeUndefined();
  });

  test("it keeps the earlier description on a tie", () => {
    const tied = [
      { profile: "one", text: THINKING },
      { profile: "two", text: THINKING },
    ];
    expect(rank(tied, "Deep design thought across files")).toBe("one");
    expect(rank([...tied].reverse(), "Deep design thought across files")).toBe("two");
  });

  test("it returns undefined when there is nothing to rank", () => {
    expect(rank([], "Fix a typo")).toBeUndefined();
  });
});
