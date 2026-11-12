import { describe, expect, test } from "bun:test";
import type { Plugin } from "@opencode/plugin/effect";
import { Session } from "@opencode/schema/session";
import { Tool } from "@opencode/schema/tool";
import { Effect, Exit } from "effect";
import { attachGuard, readAsk, rerouteInput } from "../../tools/definitions/search/guard";
import { judge, type Health } from "../../tools/definitions/search/policy";
import { markRerouted, rerouted, seen, sessionSeen } from "../../tools/definitions/search/state";

const ready: Health = { kind: "ready", binary: "/bin/ripwire", version: "0.6.10" };

const routed = (pattern: string) => {
  const verdict = judge({ ask: { pattern }, seen: new Set<string>(), health: ready });
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
    const first = Session.ID.make("ses_guard_test_a");
    const second = Session.ID.make("ses_guard_test_b");
    const seenFirst = sessionSeen(first);
    expect(sessionSeen(first)).toBe(seenFirst);
    expect(sessionSeen(second)).not.toBe(seenFirst);
    seenFirst.add("resolveTool");
    expect(judge({ ask: { pattern: "resolveTool" }, seen: seenFirst, health: ready })).toEqual({
      kind: "allow",
      why: "already-asked",
    });
    seen.delete(first);
    seen.delete(second);
  });

  test("markRerouted records the call id", () => {
    const call = Tool.CallID.make("guard-test-call");
    markRerouted(call);
    expect(rerouted.has(call)).toBe(true);
    rerouted.delete(call);
  });
});

const RIPWIRE = Bun.which("ripwire");

const event = (pattern: string): unknown => ({
  tool: "ripgrep",
  sessionID: Session.ID.make("ses_guard_test_c"),
  agent: "build",
  messageID: "msg_guard_test",
  id: Tool.CallID.make("call_guard_test"),
  input: { pattern },
});

const capture = async (
  assert: () => Effect.Effect<void, Tool.Error>,
): Promise<(event: unknown) => Effect.Effect<void, Tool.Error>> => {
  let callback: ((event: unknown) => Effect.Effect<void, Tool.Error>) | undefined;
  const ctx = {
    location: { directory: "/tmp" },
    tool: {
      hook: (_name: string, cb: (event: unknown) => Effect.Effect<void, Tool.Error>) => {
        callback = cb;
        return Effect.succeed({ dispose: Effect.void });
      },
    },
    permission: { assert },
  } as unknown as Plugin.Context;
  await Effect.runPromise(Effect.scoped(attachGuard(ctx)));
  if (callback === undefined) throw new Error("guard did not register");
  return callback;
};

describe("the guard's permission path", () => {
  test.skipIf(!RIPWIRE)("a plain permission decline is not swallowed", async () => {
    const callback = await capture(() => Effect.die(new Error("declined")));
    const exit = await Effect.runPromiseExit(callback(event("resolveTool")));
    expect(Exit.isFailure(exit)).toBe(true);
  });

  test.skipIf(!RIPWIRE)("a successful assert renames the tool and carries the route", async () => {
    const callback = await capture(() => Effect.void);
    const asked = event("resolveTool") as { tool: string; input: Record<string, unknown> };
    await Effect.runPromise(callback(asked));
    expect(asked.tool).toBe("spectre_search");
    expect(asked.input["pattern"]).toBe("resolveTool");
    rerouted.delete(Tool.CallID.make("call_guard_test"));
    seen.delete(Session.ID.make("ses_guard_test_c"));
  });
});
