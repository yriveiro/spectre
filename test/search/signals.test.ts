import { describe, expect, test } from "bun:test";
import {
  codePath,
  contextAsk,
  grepAsk,
  mutateAsk,
  promptAsk,
  readAsk,
  shellAsk,
  subagentAsk,
} from "../../tools/definitions/search/signals";

const ROOT = "/project";

describe("grepAsk reads the ripgrep payload", () => {
  test("a full payload reads", () => {
    expect(grepAsk({ pattern: "x", path: "src", include: "*.ts", literal: false }, "ripgrep")).toEqual({
      surface: "text",
      id: "ripgrep",
      ask: { pattern: "x", path: "src", include: "*.ts", literal: false },
    });
  });

  test("a bare pattern reads", () => {
    expect(grepAsk({ pattern: "x" }, "grep")).toEqual({
      surface: "text",
      id: "grep",
      ask: { pattern: "x" },
    });
  });

  test("a tool that is neither grep nor ripgrep reads nothing", () => {
    expect(grepAsk({ pattern: "x" }, "read")).toBeUndefined();
    expect(grepAsk({ pattern: "x" }, "spectre_search")).toBeUndefined();
  });

  test("a non-object, a missing pattern, and mistyped fields do not read", () => {
    expect(grepAsk(null, "ripgrep")).toBeUndefined();
    expect(grepAsk("pattern", "ripgrep")).toBeUndefined();
    expect(grepAsk({}, "ripgrep")).toBeUndefined();
    expect(grepAsk({ pattern: 3 }, "ripgrep")).toBeUndefined();
    expect(grepAsk({ pattern: "x", path: 3 }, "ripgrep")).toBeUndefined();
    expect(grepAsk({ pattern: "x", include: 3 }, "ripgrep")).toBeUndefined();
    expect(grepAsk({ pattern: "x", literal: "yes" }, "ripgrep")).toBeUndefined();
  });
});

describe("shellAsk reads the command", () => {
  test("a ripwire lookup carries its flags", () => {
    expect(shellAsk({ command: "ripwire . --quality-delta" })).toEqual({
      surface: "shell",
      command: "ripwire . --quality-delta",
      parsed: {
        kind: "ripwire",
        command: "ripwire . --quality-delta",
        lookup: true,
        delta: true,
        affected: false,
        fanout: false,
      },
    });
  });

  test("a ripwire help call is not a lookup", () => {
    const ask = shellAsk({ command: "ripwire --help" });
    expect(ask?.parsed.kind).toBe("ripwire");
    if (ask?.parsed.kind !== "ripwire") throw new Error("expected a ripwire command");
    expect(ask.parsed.lookup).toBe(false);
  });

  test("a landing command reads as a landing", () => {
    expect(shellAsk({ command: "git commit -m land" })?.parsed).toEqual({
      kind: "landing",
      command: "git commit -m land",
    });
    expect(shellAsk({ command: "gh pr create --fill" })?.parsed.kind).toBe("landing");
  });

  test("a command it does not classify reads as other", () => {
    expect(shellAsk({ command: "ls -la" })?.parsed.kind).toBe("other");
    expect(shellAsk({ command: "git commit-tree abc" })?.parsed.kind).toBe("other");
    expect(shellAsk({ command: "npm run typecheck" })?.parsed.kind).toBe("other");
  });

  test("a payload with no command does not read", () => {
    expect(shellAsk(null)).toBeUndefined();
    expect(shellAsk({})).toBeUndefined();
    expect(shellAsk({ command: 3 })).toBeUndefined();
  });
});

describe("readAsk reads the path", () => {
  test("a code file inside the root is code and inside", () => {
    expect(readAsk({ path: "src/retry.ts" }, ROOT)).toEqual({
      surface: "read",
      path: "src/retry.ts",
      code: true,
      insideRoot: true,
    });
    expect(readAsk({ path: `${ROOT}/src/retry.ts` }, ROOT)?.insideRoot).toBe(true);
  });

  test("a path outside the root is not inside", () => {
    expect(readAsk({ path: "../outside/retry.ts" }, ROOT)?.insideRoot).toBe(false);
  });

  test("a doc, a config file, and a file with no extension are not code", () => {
    expect(readAsk({ path: "docs/readme.md" }, ROOT)?.code).toBe(false);
    expect(readAsk({ path: "package.json" }, ROOT)?.code).toBe(false);
    expect(readAsk({ path: "Makefile" }, ROOT)?.code).toBe(false);
  });

  test("a payload with no path does not read", () => {
    expect(readAsk(null, ROOT)).toBeUndefined();
    expect(readAsk({}, ROOT)).toBeUndefined();
    expect(readAsk({ path: 3 }, ROOT)).toBeUndefined();
  });
});

describe("codePath", () => {
  test("it names the code languages and nothing else", () => {
    expect(codePath("a/b.ts")).toBe(true);
    expect(codePath("a/b.PY")).toBe(true);
    expect(codePath("a/b.md")).toBe(false);
    expect(codePath("a/b.json")).toBe(false);
    expect(codePath("a/b")).toBe(false);
  });
});

describe("mutateAsk reads the edit and write payload", () => {
  test("an edit and a write both read", () => {
    expect(mutateAsk({ path: "src/retry.ts" }, "edit")).toEqual({
      surface: "mutate",
      tool: "edit",
      path: "src/retry.ts",
      code: true,
    });
    expect(mutateAsk({ path: "src/retry.ts" }, "write")?.tool).toBe("write");
  });

  test("a tool that is neither edit nor write reads nothing", () => {
    expect(mutateAsk({ path: "src/retry.ts" }, "read")).toBeUndefined();
    expect(mutateAsk({}, "edit")).toBeUndefined();
    expect(mutateAsk(null, "write")).toBeUndefined();
  });
});

describe("subagentAsk reads the child a spawn created", () => {
  test("a spawn reads the child its output names", () => {
    expect(subagentAsk({ agent: "explore", prompt: "x" }, { sessionID: "ses_child" })).toEqual({
      surface: "subagent",
      child: "ses_child",
    });
  });

  test("a follow-up is not a spawn", () => {
    expect(subagentAsk({ sessionID: "ses_child" }, { sessionID: "ses_child" })).toBeUndefined();
    expect(subagentAsk({ sessionID: "" }, { sessionID: "ses_child" })).toEqual({
      surface: "subagent",
      child: "ses_child",
    });
  });

  test("a call that named no child reads nothing", () => {
    expect(subagentAsk({}, {})).toBeUndefined();
    expect(subagentAsk({}, { sessionID: 3 })).toBeUndefined();
    expect(subagentAsk({ sessionID: 3 }, { sessionID: "ses_child" })).toBeUndefined();
    expect(subagentAsk(null, undefined)).toBeUndefined();
  });
});

describe("promptAsk and contextAsk read the request", () => {
  test("a prompt event reads as the prompt", () => {
    expect(promptAsk({ messageID: "msg_1" })).toEqual({ surface: "prompt" });
    expect(promptAsk(null)).toBeUndefined();
    expect(promptAsk("prompt")).toBeUndefined();
  });

  test("a context event reads the tool names the request carries", () => {
    expect(contextAsk({ tools: { spectre_search: {}, ripgrep: {} } })).toEqual({
      surface: "context",
      tools: ["spectre_search", "ripgrep"],
    });
  });

  test("a context event with no tools does not read", () => {
    expect(contextAsk({ system: [] })).toBeUndefined();
    expect(contextAsk({ tools: null })).toBeUndefined();
    expect(contextAsk(null)).toBeUndefined();
  });
});
