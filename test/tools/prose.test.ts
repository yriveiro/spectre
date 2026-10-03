import { describe, expect, test } from "bun:test";
import { AbsolutePath } from "@opencode/schema/schema";
import { Effect } from "effect";
import { prose } from "../../tools/definitions/prose";
import { countWords, lint, sentences } from "../../tools/definitions/prose/rules";

/**
 * The rules are an instrument, and an instrument nobody checked is a claim.
 * Each test names the rule it pins, so a failure says which STE rule moved.
 */

const rules = (text: string) => lint(text).map((f) => f.rule);
const hard = (text: string) =>
  lint(text)
    .filter((f) => f.level === "hard")
    .map((f) => f.rule);

describe("sentence splitting", () => {
  test("splits on a full stop followed by a capital", () => {
    expect(sentences("Read the file. Then close it.")).toEqual([
      "Read the file.",
      "Then close it.",
    ]);
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
    expect(
      lint("The job may have failed and could still be running, so it might need a retry."),
    ).toEqual([]);
  });

  test("a hedge next to a real violation still reports only the violation", () => {
    expect(rules("It may be seamless; the cause is unknown.")).toEqual([
      "semicolon",
      "marketing-adjective",
    ]);
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

  test("a code span that wraps a line break is one span", () => {
    // The semicolon is inside a TypeScript discriminant, not in prose.
    const text = ['`{ kind: "open" } | { kind: "done";', "at: Date }` cannot be built wrong."].join(
      "\n",
    );
    expect(hard(text)).not.toContain("semicolon");
  });
});

describe("the disabled set silences a rule by name", () => {
  test("disabling semicolon leaves every other rule running", () => {
    const findings = lint("It is seamless; spin up.", new Set(["semicolon"]));
    expect(findings.map((f) => f.rule).sort()).toEqual(["marketing-adjective", "phrasal-verb"]);
  });
});

describe("clean prose reports nothing", () => {
  test("the worked example from the standard's own register", () => {
    const text = [
      "The agent deletes the file.",
      "Read the configured strategy.",
      "If the strategy allows automatic resolution, the agent resolves the conflict.",
      "The agent does not resolve the conflict. It reports the conflict for review.",
    ].join("\n");
    expect(lint(text)).toEqual([]);
  });
});

describe("the tool", () => {
  const tool = prose(AbsolutePath.make(process.cwd()));

  test("declares the spectre namespace, so the dotted path resolves", () => {
    expect(tool.options?.namespace).toBe("spectre");
  });

  test("is pinned, so the catalog carries it from the first round", () => {
    expect(tool.options?.pinned).toBe(true);
  });

  test("asks for read permission and never a write", () => {
    expect(tool.options?.permission).toBe("read");
  });

  test("declares no schema field the boundary rejects", () => {
    // tools/FOR_AGENTS.md measured this at 2.0.18: Int, Finite, NonEmptyString, URL,
    // Natural and Trim all typecheck and are then rejected at call time, and the last
    // two crash the host. A field name cannot prove that, so this reads what the
    // schema actually carries at runtime.
    const rejected = ["Int", "Finite", "NonEmptyString", "URL", "Natural", "Trim"];
    const seen: Array<string> = [];
    const walk = (node: unknown, depth = 0): void => {
      if (depth > 8 || node === null || typeof node !== "object") return;
      if (Array.isArray(node)) return node.forEach((one) => walk(one, depth + 1));
      const record = node as Record<string, unknown>;
      const tag = record["toString"] ?? record["_tag"];
      if (typeof tag === "string" && rejected.includes(tag)) seen.push(tag);
      for (const value of Object.values(record)) walk(value, depth + 1);
    };
    walk(tool.input);
    // `output` is optional on Tool.Info, so the guard is a real one: a tool that
    // declares no output declares nothing the boundary could reject.
    if (tool.output !== undefined) walk(tool.output);
    expect(seen).toEqual([]);
  });

  test("keeps the input and the output inside the accepted subset", () => {
    // The same file: a tool that registers is not a tool that runs, and the only
    // proof is a real call. This asserts the shapes the table lists as accepted.
    for (const field of ["targets", "disable", "limit", "offset"]) {
      expect(Object.keys(tool.input.fields)).toContain(field);
    }
    if (tool.output !== undefined) expect(Object.keys(tool.output.fields)).toContain("findings");
  });

  test("rejects an unknown rule name rather than silently ignoring it", async () => {
    // A disabled rule that does not exist is a typo, and a silent no-op would let a
    // caller believe it turned something off.
    // execute takes a call context as well as the input, per Tool.Info at
    // tool.d.ts:75, and this tool never reads it, so the fields are stand-ins.
    const rejected = tool.execute(
      { targets: ["README.md"], disable: ["no-such-rule"] },
      {
        sessionID: "ses_test" as never,
        agent: "build" as never,
        messageID: "msg_test" as never,
        id: "call_test" as never,
        progress: () => Effect.void,
      },
    );
    await expect(Effect.runPromise(rejected)).rejects.toThrow(/unknown rule: no-such-rule/);
  });
});

describe("the set's own prose", () => {
  const call = async (targets: ReadonlyArray<string>, disable?: ReadonlyArray<string>) => {
    const tool = prose(AbsolutePath.make(process.cwd()));
    const result = await Effect.runPromise(
      tool.execute(
        { targets, disable },
        {
          sessionID: "ses_test" as never,
          agent: "build" as never,
          messageID: "msg_test" as never,
          id: "call_test" as never,
          progress: () => Effect.void,
        },
      ),
    );
    // `output` is optional on Tool.Info, so a tool that declared none would arrive
    // undefined here. The guard turns that into a readable failure.
    if (result.output === undefined) throw new Error("the tool returned no output");
    return result.output;
  };

  test("the two bodies that carry the rules pass, with the ban list disabled", async () => {
    // grammar names the marketing adjectives on purpose, because the section is the
    // list of words the rule bans. Disabling that one rule is the whole exemption.
    const out = await call(
      ["skills/definitions/grammar", "skills/definitions/communication"],
      ["marketing-adjective"],
    );
    expect(out.hard).toBe(0);
  }, 30_000);

  test("the ban list holds only words the rule bans", async () => {
    // A word added there that the rule does not ban would be a rule that cannot fail.
    const out = await call(["skills/definitions/grammar"]);
    const banned = out.findings.filter((f) => f.rule === "marketing-adjective");
    expect(banned.map((f) => f.text).toSorted()).toEqual(
      [
        "blazing-fast",
        "best-in-class",
        "cutting-edge",
        "effortless",
        "game-changing",
        "robust",
        "seamless",
        "state-of-the-art",
        "world-class",
      ].toSorted(),
    );
  }, 30_000);

  test("the debt is still on the books, and it is all semicolons", async () => {
    // The rest of the set has not been swept yet. This test is the receipt, and it
    // fails when the debt is paid so the line goes with it rather than rotting.
    const out = await call([
      "skills/definitions",
      "AGENTS.md",
      "TODO.md",
      "README.md",
      "skills/FOR_AGENTS.md",
    ]);
    const byRule: Record<string, number> = {};
    for (const f of out.findings) byRule[f.rule] = (byRule[f.rule] ?? 0) + 1;
    expect({
      semicolons: byRule["semicolon"] ?? 0,
      other: Object.keys(byRule)
        .filter((r) => r !== "semicolon")
        .toSorted(),
    }).toEqual({
      semicolons: 150,
      other: ["marketing-adjective", "passive-voice", "phrasal-verb", "present-perfect"],
    });
  }, 60_000);
});

describe("with no dictionary configured", () => {
  const bare = prose(AbsolutePath.make(process.cwd()));

  const call = async (input: Parameters<typeof bare.execute>[0]) => {
    const result = await Effect.runPromise(
      bare.execute(input, {
        sessionID: "ses_test" as never,
        agent: "build" as never,
        messageID: "msg_test" as never,
        id: "call_test" as never,
        progress: () => Effect.void,
      }),
    );
    if (result.output === undefined) throw new Error("the tool returned no output");
    return result.output;
  };

  test("the structural half runs with no dictionary at all", async () => {
    // The six structural rules need no word list. A caller with no `dictionary` in
    // spectre.jsonc still gets them, which is the whole point of splitting them.
    const out = await call({ targets: ["skills/definitions/grammar/SKILL.md"] });
    expect(out.findings.length).toBeGreaterThan(0);
    expect(out.rulings).toEqual([]);
    expect(out.dictionary).toBeUndefined();
  }, 30_000);

  test("asking about words with no dictionary is not an error and not an answer", async () => {
    // Silently returning `unknown` for every word would look like a verdict. An
    // empty `rulings` with no `dictionary` block says the question was not answerable.
    const out = await call({ words: ["check", "secure", "grommet"] });
    expect(out.rulings).toEqual([]);
    expect(out.dictionary).toBeUndefined();
    expect(out.errors).toEqual([]);
  }, 30_000);

  test("targets may be omitted, so a words-only call does not read the tree", async () => {
    const out = await call({ words: ["check"] });
    expect(out.findings).toEqual([]);
    expect(out.scanned).toBe(0);
  }, 30_000);
});
