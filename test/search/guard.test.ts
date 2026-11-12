import { describe, expect, test } from "bun:test";
import { readAsk, rerouteInput } from "../../tools/definitions/search/guard";
import { judge, type Health } from "../../tools/definitions/search/policy";
import { markRerouted, rerouted, seen, sessionSeen } from "../../tools/definitions/search/state";

const ready: Health = { kind: "ready", binary: "/bin/ripwire", version: "0.6.10" };

const routed = (pattern: string) => {
  const verdict = judge({ pattern }, new Set<string>(), ready);
  if (verdict.kind !== "route") throw new Error(`expected a route for ${pattern}`);
  return verdict.route;
};

describe("rerouteInput carries the verdict's route into the renamed call", () => {
  test("a task verdict sets query so the tool reads a task", () => {
    const input = rerouteInput({ pattern: "function rescue" }, routed("function rescue"));
    expect(input["query"]).toBe("function rescue");
    expect(input["pattern"]).toBe("function rescue");
    expect("kind" in input).toBe(false);
  });

  test("a regex verdict sets kind so the tool reads a regex", () => {
    const input = rerouteInput({ pattern: "re.*" }, routed("re.*"));
    expect(input["kind"]).toBe("regex");
    expect(input["pattern"]).toBe("re.*");
    expect("query" in input).toBe(false);
  });

  test("a literal verdict leaves the input alone so the tool reads a literal", () => {
    const before = { pattern: "resolveTool" };
    const input = rerouteInput(before, routed("resolveTool"));
    expect(input).toEqual({ pattern: "resolveTool" });
    expect("query" in input).toBe(false);
    expect("kind" in input).toBe(false);
  });

  test("other fields survive the handoff", () => {
    const input = rerouteInput(
      { pattern: "function rescue", path: "src", literal: false },
      routed("function rescue"),
    );
    expect(input).toEqual({ pattern: "function rescue", path: "src", literal: false, query: "function rescue" });
  });
});

describe("readAsk guards the ripgrep payload", () => {
  test("a full payload reads", () => {
    expect(
      readAsk({ pattern: "x", path: "src", include: "*.ts", literal: false }),
    ).toEqual({ pattern: "x", path: "src", include: "*.ts", literal: false });
  });

  test("a bare pattern reads", () => {
    expect(readAsk({ pattern: "x" })).toEqual({ pattern: "x" });
  });

  test("a non-object, a missing pattern, and mistyped fields do not read", () => {
    expect(readAsk(null)).toBeUndefined();
    expect(readAsk("pattern")).toBeUndefined();
    expect(readAsk({})).toBeUndefined();
    expect(readAsk({ pattern: 3 })).toBeUndefined();
    expect(readAsk({ pattern: "x", path: 3 })).toBeUndefined();
    expect(readAsk({ pattern: "x", include: 3 })).toBeUndefined();
    expect(readAsk({ pattern: "x", literal: "yes" })).toBeUndefined();
  });
});

describe("once-per-pattern state", () => {
  test("a session keeps one seen set, and a second session keeps another", () => {
    const first = sessionSeen("guard-test-a");
    expect(sessionSeen("guard-test-a")).toBe(first);
    expect(sessionSeen("guard-test-b")).not.toBe(first);
    first.add("resolveTool");
    expect(judge({ pattern: "resolveTool" }, first, ready)).toEqual({
      kind: "allow",
      why: "already-asked",
    });
    seen.delete("guard-test-a");
    seen.delete("guard-test-b");
  });

  test("markRerouted records the call id", () => {
    markRerouted("guard-test-call");
    expect(rerouted.has("guard-test-call")).toBe(true);
    rerouted.delete("guard-test-call");
  });
});
