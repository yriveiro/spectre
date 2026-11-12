import { describe, expect, test } from "bun:test";
import { argv, judge, type Health } from "../../tools/definitions/search/policy";

const ready: Health = { kind: "ready", binary: "/bin/ripwire", version: "0.6.10" };
const absent: Health = { kind: "absent", why: "no binary" };
const stale: Health = { kind: "stale", binary: "/bin/ripwire", version: "0.5.0" };
const empty = new Set<string>();

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
