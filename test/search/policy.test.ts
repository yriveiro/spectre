import { describe, expect, test } from "bun:test";
import { CONTRACT } from "../../tools/definitions/search/contract";
import {
  argv,
  contextRule,
  decide,
  type Env,
  type Health,
  judge,
  type Memory,
  shellParse,
} from "../../tools/definitions/search/policy";

const ready: Health = { kind: "ready", binary: "/bin/ripwire", version: "0.7.0" };
const absent: Health = { kind: "absent", why: "no binary" };
const stale: Health = { kind: "stale", binary: "/bin/ripwire", version: "0.5.0" };
const empty = new Set<string>();

const held = (overrides?: Partial<Memory>): Memory => ({
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

const env = (overrides?: Partial<Env>): Env => ({ health: ready, ...overrides });

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
    expect(judge({ ask: { pattern: "line one\nline two" }, seen: empty, health: ready })).toEqual({
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
    for (const pattern of [
      "function rescue",
      "const x = 1",
      "(x) => x",
      "std::vector int",
      "fn run -> bool",
    ]) {
      expect(judge({ ask: { pattern }, seen: empty, health: ready })).toEqual({
        kind: "route",
        route: { kind: "task", task: pattern },
      });
    }
  });

  test("a phrase with no code token stays on the text tool", () => {
    expect(
      judge({ ask: { pattern: "where retry is decided" }, seen: empty, health: ready }),
    ).toEqual({
      kind: "allow",
      why: "plain-text",
    });
  });

  test("a regex that holds a space or grouped alternation routes as a regex, not as a task or prose", () => {
    for (const pattern of [
      "CallID|namespace Session|ID =",
      "//|do not remove|@ts-(?:ignore|expect-error)",
      "(foo|bar) baz",
    ]) {
      expect(judge({ ask: { pattern }, seen: empty, health: ready })).toEqual({
        kind: "route",
        route: { kind: "regex", pattern },
      });
    }
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
  test("a task defaults to answer-first --for with no --signatures-only, no --token-budget, and no --legend=compact", () => {
    expect(
      argv({ route: { kind: "task", task: "function rescue" }, root: "/root" }),
    ).toEqual(["/root", "--for=function rescue"]);
  });

  test("a task with an explicit budget passes --token-budget and suppresses --page-bytes", () => {
    expect(
      argv({ route: { kind: "task", task: "function rescue" }, root: "/root", budget: 4000, page: 2 }),
    ).toEqual(["/root", "--for=function rescue", "--token-budget=4000"]);
  });

  test("a task with page > 1 and no budget passes --page-bytes=12000:<floor(page)>", () => {
    expect(
      argv({ route: { kind: "task", task: "function rescue" }, root: "/root", page: 2.8 }),
    ).toEqual(["/root", "--for=function rescue", "--page-bytes=12000:2"]);
    expect(
      argv({ route: { kind: "task", task: "function rescue" }, root: "/root", page: 1 }),
    ).toEqual(["/root", "--for=function rescue"]);
  });

  test("an expand carries the expand flag without --legend=compact", () => {
    expect(
      argv({ route: { kind: "expand", symbol: "src/a.ts:rescue" }, root: "/root", budget: 4000 }),
    ).toEqual(["/root", "--expand=src/a.ts:rescue"]);
  });

  test("a literal carries the grep flag and a 50-hit limit", () => {
    expect(
      argv({ route: { kind: "literal", text: "resolveTool" }, root: "/root", budget: 4000 }),
    ).toEqual(["/root", "--grep=resolveTool", "--limit=50"]);
  });

  test("a regex carries the regex flag and a 50-hit limit", () => {
    expect(
      argv({ route: { kind: "regex", pattern: "re.*" }, root: "/root", budget: 4000 }),
    ).toEqual(["/root", "--regex=re.*", "--limit=50"]);
  });

  test("legendSeen appends --legend-seen=<file> on every route when non-empty", () => {
    const legendSeen = "/tmp/seen.txt";
    expect(
      argv({ route: { kind: "task", task: "x" }, root: "/root", legendSeen }),
    ).toEqual(["/root", "--for=x", `--legend-seen=${legendSeen}`]);
    expect(
      argv({ route: { kind: "expand", symbol: "a:b" }, root: "/root", legendSeen }),
    ).toEqual(["/root", "--expand=a:b", `--legend-seen=${legendSeen}`]);
    expect(
      argv({ route: { kind: "literal", text: "foo" }, root: "/root", legendSeen }),
    ).toEqual(["/root", "--grep=foo", "--limit=50", `--legend-seen=${legendSeen}`]);
    expect(
      argv({ route: { kind: "regex", pattern: "f.*" }, root: "/root", legendSeen }),
    ).toEqual(["/root", "--regex=f.*", "--limit=50", `--legend-seen=${legendSeen}`]);
    expect(
      argv({ route: { kind: "task", task: "x" }, root: "/root", legendSeen: "" }),
    ).toEqual(["/root", "--for=x"]);
  });
});

describe("decide, the text surface", () => {
  const text = (pattern: string, overrides?: Partial<Memory>) =>
    decide({ surface: "text", id: "ripgrep", ask: { pattern } }, held(overrides), env());

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
    expect(decision.verdict.input.query).toBe("function rescue");
  });

  test("a regex reroutes as a regex", () => {
    const decision = text("re.*");
    if (decision.verdict.kind !== "reroute") throw new Error("expected a reroute");
    expect(decision.verdict.input.kind).toBe("regex");
  });

  test("the reroute records the pattern as pending and leaves the input memory alone", () => {
    const before = held();
    const decision = decide(
      { surface: "text", id: "ripgrep", ask: { pattern: "resolveTool" } },
      before,
      env(),
    );
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
    expect(
      decide(
        { surface: "text", id: "ripgrep", ask: { pattern: "resolveTool" } },
        held(),
        env({ health: absent }),
      ).verdict,
    ).toEqual({ kind: "pass", why: "no-instrument" });
  });

  test("a literal call and a short pattern keep the judge's rows", () => {
    expect(
      decide(
        { surface: "text", id: "grep", ask: { pattern: "function rescue", literal: true } },
        held(),
        env(),
      ).verdict,
    ).toEqual({ kind: "pass", why: "plain-text" });
    expect(text("ab").verdict).toEqual({ kind: "pass", why: "too-broad" });
  });
});

describe("decide, the context surface", () => {
  test("it records whether the request holds the search tool", () => {
    expect(
      decide({ surface: "context", tools: ["spectre_search"] }, held(), env()).next.search,
    ).toBe(true);
    expect(decide({ surface: "context", tools: ["grep"] }, held(), env()).next.search).toBe(false);
  });

  test("a ready session carries CONTRACT.rule and the compact moment cues", () => {
    const rule = contextRule(ready);
    expect(rule).toContain(CONTRACT.rule);
    expect(rule).toContain('<act read="path:l-e,..."/>');
    expect(rule).toContain("name@lang");
    expect(rule).toContain("--exemplar=");
    expect(rule).toContain("ripwire . --impact=<sym> --uses=<sym>");
    expect(rule).toContain("--impact=");
    expect(rule).toContain("--pack-task=");
    expect(rule).toContain("--stray-content");
    expect(rule).toContain('tools.spectre.ripwire({ action: "check" })');
    expect(rule).toContain('range: "main..HEAD"');
    expect(rule).not.toContain("this session is native");
    expect(decide({ surface: "context", tools: [] }, held(), env()).verdict).toEqual({
      kind: "prose",
      key: "rule",
      text: rule,
    });
  });

  test("a session with no instrument is told that it is native and carries zero CLI cues", () => {
    for (const health of [absent, stale]) {
      const rule = contextRule(health);
      expect(rule).toContain(CONTRACT.rule);
      expect(rule).toContain("this session is native");
      expect(rule).not.toContain("--exemplar=");
      expect(rule).not.toContain("--impact=");
      expect(rule).not.toContain("--pack-task=");
      expect(rule).not.toContain("--stray-content");
      expect(rule).not.toContain("tools.spectre.ripwire");
    }
    expect(
      decide({ surface: "context", tools: [] }, held(), env({ health: absent })).verdict,
    ).toEqual({
      kind: "prose",
      key: "rule",
      text: contextRule(absent),
    });
  });
});

describe("decide, the shell surface", () => {
  const shell = (command: string, overrides?: Partial<Memory>) =>
    decide({ surface: "shell", command, parsed: shellParse(command) }, held(overrides), env());

  test("a ripwire lookup counts and records the measurement at the current code edit count", () => {
    const decision = shell("ripwire . --quality-delta --affected=src/a.ts", {
      mutation: 5,
      editedCode: new Set(["src/a.ts", "src/b.ts", "src/c.ts"]),
    });
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
    expect(
      shell("git commit -m land", {
        mutation: 2,
        editedCode: new Set(["src/a.ts"]),
        spent: new Set(["land"]),
      }).verdict,
    ).toEqual({
      kind: "pass",
      why: "gate-spent",
    });
  });

  test("a landing with both measurements fresh passes as measured", () => {
    expect(
      shell("git push", {
        mutation: 2,
        editedCode: new Set(["src/a.ts"]),
        measured: { delta: 1, affected: 1 },
      }).verdict,
    ).toEqual({ kind: "pass", why: "measured" });
  });

  test("a landing with nothing measured refuses once, then the second call passes", () => {
    const first = shell("git push", { mutation: 2, editedCode: new Set(["src/a.ts"]) });
    expect(first.verdict.kind).toBe("refuse");
    expect(first.next.spent.has("land")).toBe(true);
    expect(first.next.mutation).toBe(2);
    expect(
      shell("git push", {
        mutation: 2,
        editedCode: new Set(["src/a.ts"]),
        spent: new Set(["land"]),
      }).verdict,
    ).toEqual({
      kind: "pass",
      why: "gate-spent",
    });
  });

  test("a delta older than the last code edit does not count as fresh", () => {
    const first = shell("git push", {
      mutation: 4,
      editedCode: new Set(["src/a.ts", "src/b.ts", "src/c.ts"]),
      measured: { delta: 2, affected: 3 },
    });
    expect(first.verdict.kind).toBe("refuse");
  });
});

describe("decide, the read surface", () => {
  const read = (overrides?: Partial<Memory>) =>
    decide(
      { surface: "read", path: "src/retry.ts", code: true, insideRoot: true },
      held(overrides),
      env(),
    );

  test("a doc and a path outside the root pass without counting", () => {
    expect(
      decide({ surface: "read", path: "readme.md", code: false, insideRoot: true }, held(), env())
        .verdict,
    ).toEqual({ kind: "pass", why: "not-code" });
    expect(
      decide({ surface: "read", path: "../x.ts", code: true, insideRoot: false }, held(), env())
        .verdict,
    ).toEqual({ kind: "pass", why: "outside-root" });
  });

  test("a session that used ripwire, read once, or edited the file passes", () => {
    expect(read({ touched: 1 }).verdict).toEqual({ kind: "pass", why: "already-used" });
    expect(read({ reads: 1 }).verdict).toEqual({ kind: "pass", why: "already-read" });
    expect(read({ edited: new Set(["src/retry.ts"]) }).verdict).toEqual({
      kind: "pass",
      why: "already-edit",
    });
    expect(read({ spent: new Set(["read"]) }).verdict).toEqual({ kind: "pass", why: "gate-spent" });
  });

  test("a code read that passes a row is counted", () => {
    expect(read({ touched: 1 }).next.reads).toBe(1);
  });

  test("a first code read refuses once, and the second call passes", () => {
    const first = read();
    expect(first.verdict.kind).toBe("refuse");
    expect(first.next.spent.has("read")).toBe(true);
    expect(first.next.reads).toBe(0);
    expect(read({ spent: new Set(["read"]) }).verdict).toEqual({ kind: "pass", why: "gate-spent" });
  });
});

describe("decide, mutate and subagent", () => {
  test("a mutation records the path and bumps the count", () => {
    const decision = decide(
      { surface: "mutate", tool: "edit", path: "src/retry.ts", code: true },
      held(),
      env(),
    );
    expect(decision.verdict).toEqual({ kind: "pass", why: "not-a-gate" });
    expect(decision.next.edited.has("src/retry.ts")).toBe(true);
    expect(decision.next.editedCode.has("src/retry.ts")).toBe(true);
    expect(decision.next.mutation).toBe(1);
  });

  test("a subagent is counted", () => {
    const decision = decide({ surface: "subagent", child: "ses_child" }, held(), env());
    expect(decision.verdict).toEqual({ kind: "pass", why: "not-a-gate" });
    expect(decision.next.subagents).toBe(1);
  });
});
