import { describe, expect, test } from "bun:test";
import type { Fields } from "../../tools/definitions/pr/fields";
import { compose } from "../../tools/definitions/pr/render";
import { lint } from "../../tools/definitions/pr/lint";

const fields = (over: Partial<Fields> = {}): Fields => ({
  type: "feat",
  scope: "spectre",
  subject: "compose the pull request title from fields",
  summary: "Agents wrote pull requests by hand, so the shape of one was whatever the run produced.",
  review: "Is the lint fail-closed, or does it only warn?",
  scopeItems: ["tools/definitions/pr/render.ts"],
  validation: [{ check: "bun test test/pr", result: "38 pass, 0 fail" }],
  risk: "Adds a tool. Reverting the folder removes it.",
  ...over,
});

describe("the composition is the literal bytes", () => {
  test("the title is type, scope and subject with no trailing period", () => {
    expect(compose(fields()).title).toBe("feat(spectre): compose the pull request title from fields");
  });

  test("a breaking field puts `!` before the colon", () => {
    const draft = compose(fields({ breaking: "The input field `body` is gone. Pass `fields` instead." }));
    expect(draft.title).toBe("feat(spectre)!: compose the pull request title from fields");
    expect(draft.body).toContain(
      "## Breaking Changes\n\nThe input field `body` is gone. Pass `fields` instead.",
    );
  });

  test("an absent optional leaves its heading out rather than filling it", () => {
    expect(compose(fields()).body).not.toContain("## Tradeoffs");
    expect(compose(fields({ tradeoffs: "A field beats a free-text body, because the shape is then the tool's." }))
      .body).toContain("## Tradeoffs");
  });

  test("the merge gate is unticked, so no run can report an approval it did not read", () => {
    const { body } = compose(fields());
    expect(body).toContain("## Merge Gate\n\n- [ ] Explicit direct user approval is recorded.");
    expect(body).not.toContain("- [x]");
  });

  test("a validation entry renders as a check and what it returned", () => {
    expect(compose(fields()).body).toContain("## Validation\n\n- bun test test/pr → 38 pass, 0 fail");
  });

  test("the same fields compose to the same bytes twice", () => {
    expect(compose(fields())).toEqual(compose(fields()));
  });
});

/** The lint result as rule names, so a failure names the rule that broke. */
const rules = (over: Partial<Fields> = {}) => lint(fields(over), compose(fields(over))).map((one) => one.rule);

describe("the lint is fail-closed and each rule is reachable", () => {
  test("well-formed fields clear every rule", () => {
    expect(rules()).toEqual([]);
  });

  test("a title over 72 characters is refused", () => {
    expect(rules({ subject: "compose the pull request title and the body and the merge gate together" }))
      .toContain("title-length");
  });

  test("a subject with a final period is refused", () => {
    expect(rules({ subject: "compose the pull request." })).toContain("title-period");
  });

  test("two clauses in one subject are a split that failed", () => {
    expect(rules({ subject: "compose the title and the body" })).toContain("title-one-clause");
    expect(rules({ subject: "compose the title; drop the old body" })).toContain("title-one-clause");
    expect(rules({ subject: "compose the title, drop the old body" })).toContain("title-one-clause");
  });

  test("a scope that is not a lowercase noun is refused", () => {
    expect(rules({ scope: "Spectre" })).toContain("scope-lowercase");
  });

  test("an empty scope list names no symbol, so it is refused", () => {
    expect(rules({ scopeItems: [] })).toContain("scope-items");
  });

  test("no validation entry is not good news, it is no evidence", () => {
    expect(rules({ validation: [] })).toContain("validation-evidence");
  });

  test("a commit SHA in the body is refused, because git log holds that text", () => {
    expect(rules({ risk: "Reverts abc1234def5678." })).toContain("body-no-sha");
  });

  test("a numbered list is a changelog in a pull request's clothes", () => {
    expect(rules({ risk: "1. first commit\n2. second commit" })).toContain("body-no-commit-list");
  });

  test("a summary that runs to two paragraphs is refused", () => {
    expect(rules({ summary: "First paragraph.\n\nSecond paragraph." })).toContain(
      "summary-one-paragraph",
    );
  });

  test("an optional filled with `None.` is refused, and the rule is about that word", () => {
    expect(rules({ tradeoffs: "None." })).toContain("tradeoffs-not-none");
    expect(rules({ breaking: "none" })).toContain("breaking-not-none");
  });

  test("a body over forty lines is refused", () => {
    // A scope list is what actually pushes a body past the limit, so it is the list that
    // grows: one bullet per line, which is how a reviewer reads it.
    const many = Array.from({ length: 45 }, (_, at) => `tools/definitions/pr/file-${at}.ts`);
    expect(rules({ scopeItems: many })).toContain("body-length");
  });

  test("a body at the limit is not refused, so the rule has an edge", () => {
    const body = compose(fields()).body;
    expect(body.split("\n").length).toBeLessThan(40);
    expect(rules()).toEqual([]);
  });

  test("every finding carries a detail, so a refusal says what to change", () => {
    const found = lint(fields({ subject: "a and b" }), compose(fields({ subject: "a and b" })));
    expect(found.length).toBeGreaterThan(0);
    for (const one of found) {
      expect(one.rule).not.toBe("");
      expect(one.detail).not.toBe("");
    }
  });
});