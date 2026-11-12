import { describe, expect, test } from "bun:test";
import { argv, judge, type Health } from "../../tools/definitions/search/policy";

const ready: Health = { kind: "ready", binary: "/bin/ripwire", version: "0.6.10" };
const absent: Health = { kind: "absent", why: "no binary" };
const stale: Health = { kind: "stale", binary: "/bin/ripwire", version: "0.5.0" };
const empty = new Set<string>();

describe("judge", () => {
  test("literal: true stays on the text tool", () => {
    expect(judge({ pattern: "function rescue", literal: true }, empty, ready)).toEqual({
      kind: "allow",
      why: "plain-text",
    });
  });

  test("a missing instrument stays on the text tool", () => {
    expect(judge({ pattern: "resolveTool" }, empty, absent)).toEqual({
      kind: "allow",
      why: "no-instrument",
    });
  });

  test("a stale instrument stays on the text tool", () => {
    expect(judge({ pattern: "resolveTool" }, empty, stale)).toEqual({
      kind: "allow",
      why: "no-instrument",
    });
  });

  test("a two-character pattern is too broad", () => {
    expect(judge({ pattern: "ab" }, empty, ready)).toEqual({
      kind: "allow",
      why: "too-broad",
    });
  });

  test("a plain-text path stays on the text tool", () => {
    expect(judge({ pattern: "TODO", path: "debug.log" }, empty, ready)).toEqual({
      kind: "allow",
      why: "plain-text",
    });
  });

  test("a plain-text include stays on the text tool", () => {
    expect(judge({ pattern: "TODO", include: "*.MD" }, empty, ready)).toEqual({
      kind: "allow",
      why: "plain-text",
    });
  });

  test("a newline pattern stays on the text tool", () => {
    expect(judge({ pattern: "line one\nline two" }, empty, ready)).toEqual({
      kind: "allow",
      why: "plain-text",
    });
  });

  test("a seen pattern stays on the text tool", () => {
    expect(judge({ pattern: "resolveTool" }, new Set(["resolveTool"]), ready)).toEqual({
      kind: "allow",
      why: "already-asked",
    });
  });

  test("a phrase with a code token routes as a task", () => {
    expect(judge({ pattern: "function rescue" }, empty, ready)).toEqual({
      kind: "route",
      route: { kind: "task", task: "function rescue" },
    });
  });

  test("a phrase with no code token stays on the text tool", () => {
    expect(judge({ pattern: "where retry is decided" }, empty, ready)).toEqual({
      kind: "allow",
      why: "plain-text",
    });
  });

  test("a bare symbol routes as a literal", () => {
    expect(judge({ pattern: "resolveTool" }, empty, ready)).toEqual({
      kind: "route",
      route: { kind: "literal", text: "resolveTool" },
    });
  });

  test("a regex routes as a regex", () => {
    expect(judge({ pattern: "re.*" }, empty, ready)).toEqual({
      kind: "route",
      route: { kind: "regex", pattern: "re.*" },
    });
  });
});

describe("argv", () => {
  test("a task carries the signatures flag and the budget", () => {
    expect(argv({ kind: "task", task: "function rescue" }, "/root", 4000)).toEqual([
      "/root",
      "--for=function rescue",
      "--signatures-only",
      "--token-budget=4000",
    ]);
  });

  test("a literal carries the grep flag", () => {
    expect(argv({ kind: "literal", text: "resolveTool" }, "/root", 4000)).toEqual([
      "/root",
      "--grep=resolveTool",
    ]);
  });

  test("a regex carries the regex flag", () => {
    expect(argv({ kind: "regex", pattern: "re.*" }, "/root", 4000)).toEqual([
      "/root",
      "--regex=re.*",
    ]);
  });
});
