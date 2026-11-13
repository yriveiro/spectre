import { describe, expect, test } from "bun:test";
import {
  decide,
  type Health,
  type Memory,
  patternRoute,
  shellParse,
} from "../../tools/definitions/search/policy";

/**
 * The shell reader and the shell rows. A bare `rg` or `git grep` with one
 * pattern and at most one path reroutes. Every composed or ambiguous command
 * passes as `unmappable`, so the native command answers in the same call.
 */

const ready: Health = { kind: "ready", binary: "/bin/ripwire", version: "0.6.10" };
const absent: Health = { kind: "absent", why: "ripwire is not on PATH" };

const held = (overrides?: Partial<Memory>): Memory => ({
  attached: false,
  subagent: false,
  search: true,
  touched: 0,
  asked: new Map(),
  reads: 0,
  edited: new Set(),
  editedCode: new Set(),
  mutation: 0,
  measured: {},
  spent: new Set(),
  subagents: 0,
  ...overrides,
});

const shell = (command: string, overrides?: Partial<Memory>, health: Health = ready) =>
  decide(
    { surface: "shell", command, parsed: shellParse(command) },
    held(overrides),
    { health, skill: true, parentID: false },
  );

describe("shellParse reads one bare search", () => {
  test("rg with a flag, a pattern and a path", () => {
    expect(shellParse("rg -n resolveTool src")).toEqual({ kind: "search", pattern: "resolveTool", path: "src" });
  });

  test("rg with a quoted pattern holds the space", () => {
    expect(shellParse(`rg -n "function resolveTool" src`)).toEqual({
      kind: "search",
      pattern: "function resolveTool",
      path: "src",
    });
  });

  test("rg with no path searches the tree", () => {
    expect(shellParse("rg resolveTool")).toEqual({ kind: "search", pattern: "resolveTool" });
  });

  test("git grep with the -- separator", () => {
    expect(shellParse("git grep -n resolveTool -- src")).toEqual({
      kind: "search",
      pattern: "resolveTool",
      path: "src",
    });
  });

  test("git grep with no path", () => {
    expect(shellParse("git grep resolveTool")).toEqual({ kind: "search", pattern: "resolveTool" });
  });

  test("an absolute binary path is still rg", () => {
    expect(shellParse("/usr/local/bin/rg resolveTool")).toEqual({ kind: "search", pattern: "resolveTool" });
  });

  test("the ripgrep binary name is still rg", () => {
    expect(shellParse("ripgrep resolveTool src")).toEqual({ kind: "search", pattern: "resolveTool", path: "src" });
  });

  test("grep with combined short flags maps its recursive search", () => {
    expect(shellParse("grep -rn resolveTool src")).toEqual({ kind: "search", pattern: "resolveTool", path: "src" });
  });

  test("grep with separated short flags maps the same search", () => {
    expect(shellParse("grep -r -n resolveTool src")).toEqual({
      kind: "search",
      pattern: "resolveTool",
      path: "src",
    });
  });

  test("grep with a file and no recursive flag maps its search", () => {
    expect(shellParse("grep resolveTool src/retry.ts")).toEqual({
      kind: "search",
      pattern: "resolveTool",
      path: "src/retry.ts",
    });
  });

  test("grep with --recursive and no path maps the whole tree", () => {
    expect(shellParse("grep --recursive resolveTool")).toEqual({ kind: "search", pattern: "resolveTool" });
  });

  test("grep with --include carries the filter", () => {
    expect(shellParse("grep -rn --include=*.ts resolveTool src")).toEqual({
      kind: "search",
      pattern: "resolveTool",
      path: "src",
      include: "*.ts",
    });
    expect(shellParse("grep -rn --include '*.ts' resolveTool src")).toEqual({
      kind: "search",
      pattern: "resolveTool",
      path: "src",
      include: "*.ts",
    });
  });

  test("a fixed-strings flag marks the search literal", () => {
    expect(shellParse("rg -F 'a|b'")).toEqual({ kind: "search", pattern: "a|b", literal: true });
    expect(shellParse("rg --fixed-strings 'a|b'")).toEqual({ kind: "search", pattern: "a|b", literal: true });
    expect(shellParse("rg --literal 'a|b'")).toEqual({ kind: "search", pattern: "a|b", literal: true });
    expect(shellParse("grep -rnF 'a|b' src")).toEqual({
      kind: "search",
      pattern: "a|b",
      path: "src",
      literal: true,
    });
  });
});

describe("shellParse passes everything it cannot map", () => {
  const unmappable = [
    "rg resolveTool src | head",
    "rg resolveTool > out.txt",
    "rg resolveTool < in.txt",
    "rg resolveTool; echo done",
    "rg resolveTool && echo done",
    "rg resolveTool || echo done",
    "rg $(which resolveTool)",
    "rg `which resolveTool`",
    "rg -e resolveTool src",
    "rg -f patterns.txt src",
    "rg resolveTool src docs",
    "git grep resolveTool -- src docs",
    "rg -g '*.ts' resolveTool",
    "rg -n",
    "rg --",
    `rg "unbalanced`,
    "grep resolveTool",
    "grep -rn resolveTool src docs",
    "grep -e resolveTool src",
    "grep -f patterns.txt -rn resolveTool src",
    "grep -rn --exclude=*.md resolveTool src",
  ];

  for (const command of unmappable) {
    test(`${command} is unmappable`, () => {
      expect(shellParse(command)).toEqual({ kind: "unmappable" });
    });
  }

  test("a command that is not a search is other", () => {
    expect(shellParse("npm run typecheck")).toEqual({ kind: "other" });
    expect(shellParse("git status")).toEqual({ kind: "other" });
    expect(shellParse("node script.js")).toEqual({ kind: "other" });
    expect(shellParse("git grepfoo")).toEqual({ kind: "other" });
  });
});

describe("patternRoute keeps a shell pattern literal or regex", () => {
  test("a plain symbol is a literal", () => {
    expect(patternRoute("resolveTool")).toEqual({ kind: "literal", text: "resolveTool" });
  });

  test("a metacharacter is a regex", () => {
    expect(patternRoute("re.*Tool")).toEqual({ kind: "regex", pattern: "re.*Tool" });
    expect(patternRoute("resolve|attach")).toEqual({ kind: "regex", pattern: "resolve|attach" });
  });
});

describe("decide, the shell search row", () => {
  test("a bare search reroutes with the shell origin", () => {
    expect(shell("rg -n resolveTool src").verdict).toEqual({
      kind: "reroute",
      origin: "shell",
      input: { pattern: "resolveTool", path: "src" },
    });
  });

  test("a shell grep reroutes the same way", () => {
    expect(shell("grep -rn resolveTool src").verdict).toEqual({
      kind: "reroute",
      origin: "shell",
      input: { pattern: "resolveTool", path: "src" },
    });
  });

  test("a regex pattern carries kind regex", () => {
    expect(shell("git grep -n 'resolve.*Tool'").verdict).toEqual({
      kind: "reroute",
      origin: "shell",
      input: { pattern: "resolve.*Tool", kind: "regex" },
    });
  });

  test("a fixed-strings pattern routes as a literal", () => {
    expect(shell("rg -F 'a|b'").verdict).toEqual({
      kind: "reroute",
      origin: "shell",
      input: { pattern: "a|b" },
    });
    expect(shell("rg 'a|b'").verdict).toEqual({
      kind: "reroute",
      origin: "shell",
      input: { pattern: "a|b", kind: "regex" },
    });
  });

  test("a composed or ambiguous command passes as unmappable", () => {
    expect(shell("rg resolveTool src | head").verdict).toEqual({ kind: "pass", why: "unmappable" });
    expect(shell("rg resolveTool src docs").verdict).toEqual({ kind: "pass", why: "unmappable" });
    expect(shell("rg -e resolveTool src").verdict).toEqual({ kind: "pass", why: "unmappable" });
  });

  test("an absent instrument passes as no-instrument", () => {
    expect(shell("rg resolveTool", undefined, absent).verdict).toEqual({ kind: "pass", why: "no-instrument" });
  });
});

describe("the shell search row applies the text judge", () => {
  test("a plain-text path or include passes", () => {
    expect(shell("rg -n ERROR app.log").verdict).toEqual({ kind: "pass", why: "plain-text" });
    expect(shell("grep -rn ERROR --include=*.md src").verdict).toEqual({ kind: "pass", why: "plain-text" });
    expect(shell("rg docs/README.md").verdict).toEqual({ kind: "pass", why: "plain-text" });
  });

  test("a pattern under three characters is too broad", () => {
    expect(shell("rg ab src").verdict).toEqual({ kind: "pass", why: "too-broad" });
  });

  test("a pattern the session already asked passes", () => {
    const first = shell("rg resolveTool src");
    expect(first.verdict.kind).toBe("reroute");
    expect(first.next.asked.get("resolveTool")).toEqual({ kind: "pending" });
    expect(shell("grep -rn resolveTool src", { asked: first.next.asked }).verdict).toEqual({
      kind: "pass",
      why: "already-asked",
    });
  });

  test("a request that does not hold the search tool passes", () => {
    expect(shell("rg resolveTool src", { search: false }).verdict).toEqual({
      kind: "pass",
      why: "search-unavailable",
    });
  });
});

describe("decide, the shell rows above the search", () => {
  test("a ripwire help call records no lookup", () => {
    const decision = shell("ripwire --help");
    expect(decision.verdict).toEqual({ kind: "pass", why: "not-a-search" });
    expect(decision.next.touched).toBe(0);
  });

  test("a ripwire version call records no lookup", () => {
    expect(shell("ripwire --version").next.touched).toBe(0);
  });

  test("a lookup counts and records each measurement at the current code edit count", () => {
    const decision = shell("ripwire . --quality-delta --affected=src/a.ts", {
      mutation: 5,
      editedCode: new Set(["src/a.ts", "src/b.ts", "src/c.ts"]),
    });
    expect(decision.verdict).toEqual({ kind: "pass", why: "not-a-search" });
    expect(decision.next.touched).toBe(1);
    expect(decision.next.measured).toEqual({ delta: 3, affected: 3 });
  });

  test("a ripwire call with no measurement flag records only the lookup", () => {
    const decision = shell("ripwire . --for=search", { mutation: 3, editedCode: new Set(["src/a.ts"]) });
    expect(decision.next.touched).toBe(1);
    expect(decision.next.measured).toEqual({});
  });

  test("git archaeology is not a search", () => {
    expect(shell("git log --oneline -20").verdict).toEqual({ kind: "pass", why: "not-a-search" });
    expect(shell("git show v2.2.7:packages/core/src/tool.ts").verdict).toEqual({
      kind: "pass",
      why: "not-a-search",
    });
  });
});
