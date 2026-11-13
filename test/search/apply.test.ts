import { describe, expect, test } from "bun:test";
import type { Plugin } from "@opencode/plugin/effect";
import { Session } from "@opencode/schema/session";
import { Tool } from "@opencode/schema/tool";
import { Effect, Exit } from "effect";
import { attachCatalogue, attachGuard } from "../../tools/definitions/search/apply";
import { judge, rerouteInput, type Health } from "../../tools/definitions/search/policy";
import { markRerouted, memories, rerouted } from "../../tools/definitions/search/state";

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

const RIPWIRE = Bun.which("ripwire");

const event = (pattern: string, id: string = "call_guard_test"): unknown => ({
  tool: "ripgrep",
  sessionID: Session.ID.make("ses_guard_test_c"),
  agent: "build",
  messageID: "msg_guard_test",
  id: Tool.CallID.make(id),
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
    memories.delete(Session.ID.make("ses_guard_test_c"));
  });

  test.skipIf(!RIPWIRE)("a pattern the session already asked stays native", async () => {
    const callback = await capture(() => Effect.void);
    const first = event("resolveTool", "call_guard_test_first");
    await Effect.runPromise(callback(first));
    const second = event("resolveTool", "call_guard_test_second");
    await Effect.runPromise(callback(second));
    expect((second as { tool: string }).tool).toBe("ripgrep");
    rerouted.delete(Tool.CallID.make("call_guard_test_first"));
    memories.delete(Session.ID.make("ses_guard_test_c"));
  });

  test.skipIf(!RIPWIRE)("a too-broad pattern stays native", async () => {
    const callback = await capture(() => Effect.void);
    const asked = event("ab", "call_guard_test_broad") as { tool: string };
    await Effect.runPromise(callback(asked));
    expect(asked.tool).toBe("ripgrep");
    memories.delete(Session.ID.make("ses_guard_test_c"));
  });

  test("markRerouted records the call id and its origin", () => {
    const call = Tool.CallID.make("guard-test-call");
    markRerouted(call, "grep");
    expect(rerouted.get(call)).toBe("grep");
    rerouted.delete(call);
  });
});

const captureContext = async (): Promise<(event: unknown) => Effect.Effect<void, never>> => {
  let callback: ((event: unknown) => Effect.Effect<void, never>) | undefined;
  const ctx = {
    session: {
      hook: (_name: string, cb: (event: unknown) => Effect.Effect<void, never>) => {
        callback = cb;
        return Effect.succeed({ dispose: Effect.void });
      },
    },
  } as unknown as Plugin.Context;
  await Effect.runPromise(Effect.scoped(attachCatalogue(ctx)));
  if (callback === undefined) throw new Error("catalogue did not register");
  return callback;
};

describe("the catalogue's defect path", () => {
  test("a defect is logged, never thrown, so the step continues", async () => {
    const callback = await captureContext();
    const broken = {
      system: [] as Array<{ type: "text"; text: string }>,
      tools: {
        get grep() {
          throw new Error("broken tools");
        },
      },
    };
    const exit = await Effect.runPromiseExit(callback(broken) as Effect.Effect<void, never>);
    expect(Exit.isSuccess(exit)).toBe(true);
  });
});
