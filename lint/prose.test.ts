import { describe, expect, test } from "bun:test";
import { countWords, lint, sentences } from "./prose";

/**
 * The linter is an instrument, and an instrument nobody checked is a claim.
 * Each test names the rule it pins, so a failure says which STE rule moved.
 */

const rules = (text: string) => lint(text).map((f) => f.rule);
const hard = (text: string) => lint(text).filter((f) => f.level === "hard").map((f) => f.rule);

describe("sentence splitting", () => {
  test("splits on a full stop followed by a capital", () => {
    expect(sentences("Read the file. Then close it.")).toEqual(["Read the file.", "Then close it."]);
  });

  test("a version is not two sentences", () => {
    expect(sentences("The floor is 2.0.21. Read the tag.")).toHaveLength(2);
  });

  test("an abbreviation is not a full stop", () => {
    expect(sentences("Read the manual, e.g. the torque spec.")).toHaveLength(1);
  });

  test("a filename is not two sentences", () => {
    expect(sentences("Open index.ts and edit it.")).toHaveLength(1);
  });
});

describe("word counting under STE 8.4 to 8.7", () => {
  test("an inline code span counts as one word, not as its parts", () => {
    // Three whitespace tokens: run, the span, now. Counting "bun" and "test"
    // separately would report 4 and make a snippet cost the sentence a word it
    // does not spend.
    expect(countWords("run `bun test` now")).toBe(3);
  });

  test("a hyphenated compound counts as one word", () => {
    expect(countWords("a well-known rule")).toBe(3);
  });

  test("a multi-word snippet does not trip the 25-word cap", () => {
    const snippet = `\`${Array.from({ length: 40 }, (_, i) => `token${i}`).join(" ")}\``;
    expect(hard(`Run ${snippet} now.`)).not.toContain("long-sentence");
  });
});

describe("hard rules", () => {
  test("STE 8.1 semicolon", () => {
    expect(hard("The agent deletes the file; then it logs the path.")).toContain("semicolon");
  });

  test("an em dash is not a semicolon, and STE permits every other mark", () => {
    expect(rules("The fix is one line — and it touches two files.")).not.toContain("semicolon");
  });

  test("STE 9.3 phrasal verb", () => {
    expect(hard("Spin up the job before you read the plan.")).toContain("phrasal-verb");
  });

  test("STE 3.7 nominalization", () => {
    expect(hard("It performs an analysis of the log.")).toContain("nominalization");
  });

  test("a marketing adjective is a claim with no measurement", () => {
    expect(hard("The wrapper is robust and fast.")).toContain("marketing-adjective");
  });

  test("the 25-word descriptive cap is hard", () => {
    const long = Array.from({ length: 26 }, (_, i) => `word${i}`).join(" ");
    expect(hard(`${long}.`)).toContain("long-sentence");
  });

  test("25 words exactly passes", () => {
    const exact = Array.from({ length: 25 }, (_, i) => `word${i}`).join(" ");
    expect(hard(`${exact}.`)).not.toContain("long-sentence");
  });
});

describe("advisory rules never fail a run", () => {
  test("STE 3.6 passive voice is reported", () => {
    expect(rules("queries are validated by the compiler")).toContain("passive-voice");
  });

  test("passive voice is not a hard finding", () => {
    expect(hard("queries are validated by the compiler")).not.toContain("passive-voice");
  });

  test("STE 3.2 present perfect is reported", () => {
    expect(rules("I have verified the claim at source.")).toContain("present-perfect");
  });

  test("it is still not a hard finding", () => {
    expect(hard("I have verified the claim at source.")).not.toContain("present-perfect");
  });
});

describe("modality is content, never flagged", () => {
  test("may, might and could produce no finding of any kind", () => {
    expect(lint("The job may have failed and could still be running, so it might need a retry.")).toEqual([]);
  });

  test("a hedge next to a real violation still reports only the violation", () => {
    expect(rules("It may be seamless; the cause is unknown.")).toEqual(["semicolon", "marketing-adjective"]);
  });
});

describe("markdown structure is not prose", () => {
  test("a fenced code block is skipped", () => {
    expect(lint("```ts\nconst a = 1; // ;;; seamless spin up\n```")).toEqual([]);
  });

  test("a table row is skipped", () => {
    expect(lint("| Rule | Why |\n| --- | --- |\n| x | it is seamless; spin up |")).toEqual([]);
  });

  test("an inline code span is not scanned for prose rules", () => {
    expect(lint("Run `a; b -- c` first.")).not.toContain("semicolon");
  });

  test("a list marker alone is not a sentence", () => {
    expect(lint("- \n1. \n* ")).toEqual([]);
  });
});

describe("the disabled set silences a rule by name", () => {
  test("--disable semicolon leaves every other rule running", () => {
    const findings = lint("It is seamless; spin up.", new Set(["semicolon"]));
    expect(findings.map((f) => f.rule).sort()).toEqual(["marketing-adjective", "phrasal-verb"]);
  });
});

describe("clean prose reports nothing", () => {
  test("the STE worked example from the standard's own register", () => {
    const text = [
      "The agent deletes the file.",
      "Read the configured strategy.",
      "If the strategy allows automatic resolution, the agent resolves the conflict.",
      "The agent does not resolve the conflict. It reports the conflict for review.",
    ].join("\n");
    expect(lint(text)).toEqual([]);
  });
});