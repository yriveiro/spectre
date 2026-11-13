import { describe, expect, test } from "bun:test";
import type { Plugin } from "@opencode/plugin/effect";
import { Session } from "@opencode/schema/session";
import { Tool } from "@opencode/schema/tool";
import { Effect, Exit } from "effect";
import { attachSearch } from "../../tools/definitions/search/index";
import { contextRule, judge, rerouteInput, type Health } from "../../tools/definitions/search/policy";
import { probe } from "../../tools/definitions/search/probe";
import { memories, rerouted } from "../../tools/definitions/search/state";
import { captureContext, captureGuard, guardEvent } from "./host";

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

describe("the guard's permission path", () => {
  test.skipIf(!RIPWIRE)("a plain permission decline is not swallowed", async () => {
    const { callback } = await captureGuard(() => Effect.die(new Error("declined")));
    const exit = await Effect.runPromiseExit(callback(guardEvent("resolveTool")));
    expect(Exit.isFailure(exit)).toBe(true);
  });

  test.skipIf(!RIPWIRE)("a successful assert renames the tool and carries the route", async () => {
    const { callback } = await captureGuard();
    const asked = guardEvent("resolveTool") as { tool: string; input: Record<string, unknown> };
    await Effect.runPromise(callback(asked));
    expect(asked.tool).toBe("spectre_search");
    expect(asked.input["pattern"]).toBe("resolveTool");
    rerouted.delete(Tool.CallID.make("call_guard_test"));
    memories.delete(Session.ID.make("ses_guard_test_c"));
  });

  test.skipIf(!RIPWIRE)("a pattern the session already asked stays native", async () => {
    const { callback } = await captureGuard();
    const first = guardEvent("resolveTool", "call_guard_test_first");
    await Effect.runPromise(callback(first));
    const second = guardEvent("resolveTool", "call_guard_test_second");
    await Effect.runPromise(callback(second));
    expect((second as { tool: string }).tool).toBe("ripgrep");
    rerouted.delete(Tool.CallID.make("call_guard_test_first"));
    memories.delete(Session.ID.make("ses_guard_test_c"));
  });

  test.skipIf(!RIPWIRE)("a too-broad pattern stays native", async () => {
    const { callback } = await captureGuard();
    const asked = guardEvent("ab", "call_guard_test_broad") as { tool: string };
    await Effect.runPromise(callback(asked));
    expect(asked.tool).toBe("ripgrep");
    memories.delete(Session.ID.make("ses_guard_test_c"));
  });
});

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

const context = (session: string, tools: ReadonlyArray<string>) => ({
  sessionID: Session.ID.make(session),
  system: [] as Array<{ type: "text"; text: string }>,
  tools: Object.fromEntries(tools.map((name) => [name, { description: name, input: {} }])),
});

describe("the catalogue's verdict", () => {
  test("a non-gating verdict persists its next memory: the search bit follows the request", async () => {
    const callback = await captureContext();
    const session = Session.ID.make("ses_catalogue_search");

    await Effect.runPromise(callback(context("ses_catalogue_search", ["spectre_search"])));
    expect(memories.get(session)?.search).toBe(true);

    await Effect.runPromise(callback(context("ses_catalogue_search", ["grep"])));
    expect(memories.get(session)?.search).toBe(false);

    memories.delete(session);
  });

  test("the rule the part carries is the one the probe chose", async () => {
    const callback = await captureContext();
    const session = Session.ID.make("ses_catalogue_rule");
    const asked = context("ses_catalogue_rule", ["spectre_search"]);

    await Effect.runPromise(callback(asked));
    expect(asked.system.at(-1)?.text).toBe(contextRule(await probe()));

    memories.delete(session);
  });
});

describe("attachSearch composes the surfaces", () => {
  test("it registers the prompt, the context and both tool hooks", async () => {
    const names: Array<string> = [];
    const hook =
      (surface: string) =>
      (name: string): Effect.Effect<{ dispose: Effect.Effect<void> }, never> => {
        names.push(`${surface}:${name}`);
        return Effect.succeed({ dispose: Effect.void });
      };
    const ctx = {
      session: { hook: hook("session"), get: () => Effect.succeed({}) },
      tool: { hook: hook("tool") },
      skill: { list: () => Effect.succeed({ location: {}, data: [] }) },
      storage: { get: () => Effect.succeed(undefined) },
    } as unknown as Plugin.Context;

    await Effect.runPromise(Effect.scoped(attachSearch(ctx)));
    expect(names).toEqual([
      "session:prompt",
      "session:context",
      "tool:execute.before",
      "tool:execute.after",
    ]);
  });
});
