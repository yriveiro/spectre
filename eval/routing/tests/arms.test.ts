import { describe, expect, test } from "bun:test";
import { ask, ASK, lexical, type Description } from "../arms";

const mechanical: Description = {
  profile: "mechanical",
  text: "Use when the task is small and mechanical, like a typo fix or a rename",
};

const thinking: Description = {
  profile: "thinking",
  text: "Use when the task needs deep design thought across many files",
};

const described: ReadonlyArray<Description> = [mechanical, thinking];

describe("lexical", () => {
  test("it names the description that shares the most terms", () => {
    const got = lexical(described, ["Fix a typo in a comment"]);
    expect(got).toEqual([{ prompt: "Fix a typo in a comment", got: "mechanical" }]);
  });

  test("it stays quiet when the prompt shares no term", () => {
    const got = lexical(described, ["Zebra xylophone quantum harvest"]);
    expect(got).toEqual([{ prompt: "Zebra xylophone quantum harvest", got: "none" }]);
  });

  test("it breaks a tie by the order the descriptions came in", () => {
    const tied: ReadonlyArray<Description> = [
      { profile: "one", text: "Use when the task needs deep design thought" },
      { profile: "two", text: "Use when the task needs deep design thought" },
    ];
    const got = lexical(tied, ["Deep design thought for this task"]);
    expect(got[0]?.got).toBe("one");
  });

  test("the order of the descriptions does not decide the answer", () => {
    const forward = lexical(described, ["Deep design thought across files"]);
    const backward = lexical([...described].reverse(), ["Deep design thought across files"]);
    expect(forward[0]?.got).toBe("thinking");
    expect(backward[0]?.got).toBe("thinking");
  });

  test("it stays quiet when there is nothing to rank", () => {
    const got = lexical([], ["Fix a typo"]);
    expect(got).toEqual([{ prompt: "Fix a typo", got: "none" }]);
  });
});

describe("ask", () => {
  test("it reads a bare name", async () => {
    const got = await ask(async () => "mechanical", described, ["Fix a typo"]);
    expect(got).toEqual([{ prompt: "Fix a typo", got: "mechanical" }]);
  });

  test("it reads a name with quotes and punctuation", async () => {
    const got = await ask(async () => '"mechanical."', described, ["Fix a typo"]);
    expect(got[0]?.got).toBe("mechanical");
  });

  test("it rejects a name it was not offered", async () => {
    const got = await ask(async () => "judgment", described, ["Fix a typo"]);
    expect(got[0]?.got).toBe("none");
  });

  test("a reply of none is none", async () => {
    const got = await ask(async () => "none", described, ["Zebra xylophone"]);
    expect(got[0]?.got).toBe("none");
  });

  test("it asks the written question with the request in it", async () => {
    let sent = "";
    await ask(
      async (prompt) => {
        sent = prompt;
        return "mechanical";
      },
      described,
      ["Fix a typo"],
    );
    expect(sent).toContain(ASK);
    expect(sent).toContain("Fix a typo");
    expect(sent).toContain("mechanical");
  });
});
