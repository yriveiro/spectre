import { describe, expect, test } from "bun:test";
import { Skill } from "@opencode/plugin/effect";
import { CONTRACT } from "../../tools/definitions/search/contract";
import {
  argv,
  contextRule,
  decide,
  type Env,
  judge,
  type Health,
  type Memory,
  shellParse,
} from "../../tools/definitions/search/policy";

const ready: Health = { kind: "ready", binary: "/bin/ripwire", version: "0.6.10" };
const absent: Health = { kind: "absent", why: "no binary" };
const stale: Health = { kind: "stale", binary: "/bin/ripwire", version: "0.5.0" };
const empty = new Set<string>();

const held = (overrides?: Partial<Memory>): Memory => ({
  attached: false,
  subagent: false,
  search: true,
  touched: 0,
  asked: new Map(),
  reads: 0,
  edited: new Set(),
  mutation: 0,
  measured: {},
  spent: new Set(),
  subagents: 0,
  ...overrides,
});

const env = (overrides?: Partial<Env>): Env => ({ health: ready, skill: true, parentID: false, ...overrides });

describe("judge", () => {
  test("literal: true stays on the text tool", () => {
    expect(
      judge({ ask: { pattern: "function rescue", literal: true }, seen: empty, health: ready }),
    ).toEqual({
      kind: "allow",
      why: "plain-text",
    });
  });

  test("a missing instrument stays on the text tool", () => {
    expect(judge({ ask: { pattern: "resolveTool" }, seen: empty, health: absent })).toEqual({
      kind: "allow",
      why: "no-instrument",
    });
  });

  test("a stale instrument stays on the text tool", () => {
    expect(judge({ ask: { pattern: "resolveTool" }, seen: empty, health: stale })).toEqual({
      kind: "allow",
      why: "no-instrument",
    });
  });

  test("a two-character pattern is too broad", () => {
    expect(judge({ ask: { pattern: "ab" }, seen: empty, health: ready })).toEqual({
      kind: "allow",
      why: "too-broad",
    });
  });

  test("a plain-text path stays on the text tool", () => {
    expect(
      judge({ ask: { pattern: "TODO", path: "debug.log" }, seen: empty, health: ready }),
    ).toEqual({
      kind: "allow",
      why: "plain-text",
    });
  });

  test("a plain-text include stays on the text tool", () => {
    expect(
      judge({ ask: { pattern: "TODO", include: "*.MD" }, seen: empty, health: ready }),
    ).toEqual({
      kind: "allow",
      why: "plain-text",
    });
  });

  test("a newline pattern stays on the text tool", () => {
    expect(
      judge({ ask: { pattern: "line one\nline two" }, seen: empty, health: ready }),
    ).toEqual({
      kind: "allow",
      why: "plain-text",
    });
  });

  test("a seen pattern stays on the text tool", () => {
    expect(
      judge({ ask: { pattern: "resolveTool" }, seen: new Set(["resolveTool"]), health: ready }),
    ).toEqual({
      kind: "allow",
      why: "already-asked",
    });
  });

  test("a phrase with a code token routes as a task", () => {
    expect(judge({ ask: { pattern: "function rescue" }, seen: empty, health: ready })).toEqual({
      kind: "route",
      route: { kind: "task", task: "function rescue" },
    });
  });

  test("a phrase with no code token stays on the text tool", () => {
    expect(
      judge({ ask: { pattern: "where retry is decided" }, seen: empty, health: ready }),
    ).toEqual({
      kind: "allow",
      why: "plain-text",
    });
  });

  test("a bare symbol routes as a literal", () => {
    expect(judge({ ask: { pattern: "resolveTool" }, seen: empty, health: ready })).toEqual({
      kind: "route",
      route: { kind: "literal", text: "resolveTool" },
    });
  });

  test("a regex routes as a regex", () => {
    expect(judge({ ask: { pattern: "re.*" }, seen: empty, health: ready })).toEqual({
      kind: "route",
      route: { kind: "regex", pattern: "re.*" },
    });
  });
});

describe("argv", () => {
  test("a task carries the signatures flag and the budget", () => {
    expect(
      argv({ route: { kind: "task", task: "function rescue" }, root: "/root", budget: 4000 }),
    ).toEqual(["/root", "--for=function rescue", "--signatures-only", "--token-budget=4000"]);
  });

  test("a literal carries the grep flag", () => {
    expect(argv({ route: { kind: "literal", text: "resolveTool" }, root: "/root", budget: 4000 })).toEqual([
      "/root",
      "--grep=resolveTool",
    ]);
  });

  test("a regex carries the regex flag", () => {
    expect(argv({ route: { kind: "regex", pattern: "re.*" }, root: "/root", budget: 4000 })).toEqual([
      "/root",
      "--regex=re.*",
    ]);
  });
});

describe("decide, the text surface", () => {
  const text = (pattern: string, overrides?: Partial<Memory>) =>
    decide(
      { surface: "text", id: "ripgrep", ask: { pattern } },
      held(overrides),
      env(),
    );

  test("a bare symbol reroutes as a literal and carries the pattern", () => {
    expect(text("resolveTool").verdict).toEqual({
      kind: "reroute",
      origin: "grep",
      input: { pattern: "resolveTool" },
    });
  });

  test("a code phrase reroutes as a task, so the renamed call reads a task", () => {
    const decision = text("function rescue");
    expect(decision.verdict.kind).toBe("reroute");
    if (decision.verdict.kind !== "reroute") throw new Error("expected a reroute");
    expect(decision.verdict.input["query"]).toBe("function rescue");
  });

  test("a regex reroutes as a regex", () => {
    const decision = text("re.*");
    if (decision.verdict.kind !== "reroute") throw new Error("expected a reroute");
    expect(decision.verdict.input["kind"]).toBe("regex");
  });

  test("the reroute records the pattern as pending and leaves the input memory alone", () => {
    const before = held();
    const decision = decide({ surface: "text", id: "ripgrep", ask: { pattern: "resolveTool" } }, before, env());
    expect(decision.next.asked.get("resolveTool")).toEqual({ kind: "pending" });
    expect(before.asked.size).toBe(0);
  });

  test("a pattern the session asked stays on the text tool", () => {
    expect(text("resolveTool").verdict.kind).toBe("reroute");
    const asked = new Map<string, { kind: "pending" }>([["resolveTool", { kind: "pending" }]]);
    expect(text("resolveTool", { asked }).verdict).toEqual({ kind: "pass", why: "already-asked" });
  });

  test("a request that does not hold the search tool stays native", () => {
    expect(text("resolveTool", { search: false }).verdict).toEqual({
      kind: "pass",
      why: "search-unavailable",
    });
  });

  test("a missing instrument passes every gate", () => {
    expect(decide({ surface: "text", id: "ripgrep", ask: { pattern: "resolveTool" } }, held(), env({ health: absent })).verdict).toEqual(
      { kind: "pass", why: "no-instrument" },
    );
  });

  test("a literal call and a short pattern keep the judge's rows", () => {
    expect(
      decide({ surface: "text", id: "grep", ask: { pattern: "function rescue", literal: true } }, held(), env()).verdict,
    ).toEqual({ kind: "pass", why: "plain-text" });
    expect(text("ab").verdict).toEqual({ kind: "pass", why: "too-broad" });
  });
});

describe("decide, the prompt surface", () => {
  test("the first prompt attaches the map once", () => {
    const decision = decide({ surface: "prompt" }, held(), env());
    expect(decision.verdict).toEqual({ kind: "attach", skill: Skill.ID.make("ripwire-first") });
    expect(decision.next.attached).toBe(true);
  });

  test("a second prompt does not attach again", () => {
    expect(decide({ surface: "prompt" }, held({ attached: true }), env()).verdict).toEqual({
      kind: "pass",
      why: "already-attached",
    });
  });

  test("a session with no registered map passes as no-skill", () => {
    expect(decide({ surface: "prompt" }, held(), env({ skill: false })).verdict).toEqual({
      kind: "pass",
      why: "no-skill",
    });
  });

  test("a child session is recorded, and discovery does not wait for the instrument", () => {
    const decision = decide({ surface: "prompt" }, held(), env({ parentID: true, health: absent }));
    expect(decision.next.subagent).toBe(true);
    expect(decision.verdict.kind).toBe("attach");
  });
});

describe("decide, the context surface", () => {
  test("it records whether the request holds the search tool", () => {
    expect(decide({ surface: "context", tools: ["spectre_search"] }, held(), env()).next.search).toBe(true);
    expect(decide({ surface: "context", tools: ["grep"] }, held(), env()).next.search).toBe(false);
  });

  test("it writes the rule", () => {
    expect(decide({ surface: "context", tools: [] }, held(), env()).verdict).toEqual({
      kind: "prose",
      key: "rule",
      text: CONTRACT.rule,
    });
  });

  test("a session with no instrument is told that it is native", () => {
    expect(contextRule(ready)).toBe(CONTRACT.rule);
    expect(contextRule(absent)).toContain("this session is native");
    expect(contextRule(stale)).toContain("this session is native");
    expect(decide({ surface: "context", tools: [] }, held(), env({ health: absent })).verdict).toEqual({
      kind: "prose",
      key: "rule",
      text: contextRule(absent),
    });
  });
});

describe("decide, the shell surface", () => {
  const shell = (command: string, overrides?: Partial<Memory>) =>
    decide({ surface: "shell", command, parsed: shellParse(command) }, held(overrides), env());

  test("a ripwire lookup counts and records the measurement at the current mutation", () => {
    const decision = shell("ripwire . --quality-delta --affected=src/a.ts", { mutation: 3 });
    expect(decision.verdict).toEqual({ kind: "pass", why: "not-a-search" });
    expect(decision.next.touched).toBe(1);
    expect(decision.next.measured).toEqual({ delta: 3, affected: 3 });
  });

  test("a ripwire help call is not a lookup", () => {
    const decision = shell("ripwire --help");
    expect(decision.verdict).toEqual({ kind: "pass", why: "not-a-search" });
    expect(decision.next.touched).toBe(0);
  });

  test("a command it does not classify passes as not-a-search", () => {
    expect(shell("npm run typecheck").verdict).toEqual({ kind: "pass", why: "not-a-search" });
  });

  test("a landing on a clean tree passes as nothing-edited", () => {
    expect(shell("git commit -m land").verdict).toEqual({ kind: "pass", why: "nothing-edited" });
  });

  test("a landing whose gate is spent passes", () => {
    expect(shell("git commit -m land", { mutation: 2, spent: new Set(["land"]) }).verdict).toEqual({
      kind: "pass",
      why: "gate-spent",
    });
  });

  test("a landing with both measurements fresh passes as measured", () => {
    expect(
      shell("git push", { mutation: 2, measured: { delta: 2, affected: 2 } }).verdict,
    ).toEqual({ kind: "pass", why: "measured" });
  });

  test("a landing with nothing measured passes as not-a-gate until the gate lands", () => {
    expect(shell("git push", { mutation: 2 }).verdict).toEqual({ kind: "pass", why: "not-a-gate" });
    expect(shell("git push", { mutation: 2, measured: { delta: 2 } }).verdict).toEqual({
      kind: "pass",
      why: "not-a-gate",
    });
  });
});

describe("decide, the read surface", () => {
  const read = (overrides?: Partial<Memory>) =>
    decide({ surface: "read", path: "src/retry.ts", code: true, insideRoot: true }, held(overrides), env());

  test("a doc and a path outside the root pass without counting", () => {
    expect(
      decide({ surface: "read", path: "readme.md", code: false, insideRoot: true }, held(), env()).verdict,
    ).toEqual({ kind: "pass", why: "not-code" });
    expect(
      decide({ surface: "read", path: "../x.ts", code: true, insideRoot: false }, held(), env()).verdict,
    ).toEqual({ kind: "pass", why: "outside-root" });
  });

  test("a session that used ripwire, read once, or edited the file passes", () => {
    expect(read({ touched: 1 }).verdict).toEqual({ kind: "pass", why: "already-used" });
    expect(read({ reads: 1 }).verdict).toEqual({ kind: "pass", why: "already-read" });
    expect(read({ edited: new Set(["src/retry.ts"]) }).verdict).toEqual({ kind: "pass", why: "already-edit" });
    expect(read({ spent: new Set(["read"]) }).verdict).toEqual({ kind: "pass", why: "gate-spent" });
  });

  test("a code read that passes a row is counted", () => {
    expect(read({ touched: 1 }).next.reads).toBe(1);
  });

  test("a first code read passes as not-a-gate until the gate lands", () => {
    expect(read().verdict).toEqual({ kind: "pass", why: "not-a-gate" });
    expect(read().next.reads).toBe(0);
  });
});

describe("decide, mutate and subagent", () => {
  test("a mutation records the path and bumps the count", () => {
    const decision = decide({ surface: "mutate", tool: "edit", path: "src/retry.ts" }, held(), env());
    expect(decision.verdict).toEqual({ kind: "pass", why: "not-a-gate" });
    expect(decision.next.edited.has("src/retry.ts")).toBe(true);
    expect(decision.next.mutation).toBe(1);
  });

  test("a subagent is counted", () => {
    const decision = decide({ surface: "subagent", child: "ses_child" }, held(), env());
    expect(decision.verdict).toEqual({ kind: "pass", why: "not-a-gate" });
    expect(decision.next.subagents).toBe(1);
  });
});
