import { describe, expect, test } from "bun:test";
import { Session } from "@opencode/schema/session";
import { Tool } from "@opencode/schema/tool";
import { type Health, type Memory, decide } from "../../tools/definitions/search/policy";
import { markRerouted, memories, memoryOf, remember, rerouted } from "../../tools/definitions/search/state";

const ready: Health = { kind: "ready", binary: "/bin/ripwire", version: "0.6.10" };

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

const session = (index: number): Session.ID => Session.ID.make(`ses_state_cap_${index}`);

describe("one Memory per session", () => {
  test("a session keeps one memory, and a second session keeps another", () => {
    const first = Session.ID.make("ses_state_test_a");
    const second = Session.ID.make("ses_state_test_b");
    const created = memoryOf(first);
    expect(memoryOf(first)).toBe(created);
    expect(memoryOf(second)).not.toBe(created);
    created.asked.set("resolveTool", { kind: "pending" });
    expect(memoryOf(second).asked.size).toBe(0);
    memories.delete(first);
    memories.delete(second);
  });

  test("an asked pattern stays on the text tool", () => {
    const asked = held({ asked: new Map([["resolveTool", { kind: "pending" as const }]]) });
    expect(
      decide({ surface: "text", id: "ripgrep", ask: { pattern: "resolveTool" } }, asked, {
        health: ready,
        skill: true,
        parentID: false,
      }).verdict,
    ).toEqual({ kind: "pass", why: "already-asked" });
  });

  test("remember replaces the session's memory", () => {
    const id = Session.ID.make("ses_state_test_remember");
    const next = held({ reads: 4 });
    remember(id, next);
    expect(memoryOf(id)).toBe(next);
    memories.delete(id);
  });

  test("the 65th session evicts the oldest", () => {
    memories.clear();
    const oldest = session(0);
    for (let index = 0; index < 64; index++) memoryOf(session(index));
    expect(memories.size).toBe(64);
    memoryOf(session(64));
    expect(memories.size).toBe(64);
    expect(memories.has(oldest)).toBe(false);
  });
});

describe("the reroute record", () => {
  test("markRerouted records the call id once, with its origin", () => {
    const call = Tool.CallID.make("state-test-call");
    markRerouted(call, "grep");
    expect(rerouted.get(call)).toBe("grep");
    markRerouted(call, "shell");
    expect(rerouted.get(call)).toBe("grep");
    rerouted.delete(call);
  });

  test("the 257th reroute evicts the oldest", () => {
    rerouted.clear();
    const oldest = Tool.CallID.make("state_call_0");
    for (let index = 0; index < 257; index++) markRerouted(Tool.CallID.make(`state_call_${index}`), "grep");
    expect(rerouted.size).toBe(256);
    expect(rerouted.has(oldest)).toBe(false);
    rerouted.clear();
  });
});
