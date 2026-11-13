import { afterEach, describe, expect, test } from "bun:test";
import { Session } from "@opencode/schema/session";
import { Tool } from "@opencode/schema/tool";
import { Effect, Exit } from "effect";
import { decide, type Health, type Memory } from "../../tools/definitions/search/policy";
import { grepAsk } from "../../tools/definitions/search/signals";
import { memories, rerouted } from "../../tools/definitions/search/state";
import { captureGuard, cleanupDirs, makeBin, READY_BIN, tempDir, toolEvent, withBinary } from "./host";

/**
 * The text rows and the guard's applier, against a stub binary. The guard runs
 * the real `decide`, so a case that fails here is a row the rule lost, not a
 * mock that drifted.
 */

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

afterEach(cleanupDirs);

const session = (name: string): Session.ID => Session.ID.make(name);

const clean = (...names: Array<string>): void => {
  for (const name of names) {
    memories.delete(session(name));
  }
};

describe("both search ids are read", () => {
  test("grep and ripgrep decode to the same text ask", () => {
    const grep = grepAsk({ pattern: "resolveTool" }, "grep");
    const ripgrep = grepAsk({ pattern: "resolveTool" }, "ripgrep");
    expect(grep?.surface).toBe("text");
    expect(ripgrep?.surface).toBe("text");
    if (grep === undefined || ripgrep === undefined) throw new Error("both ids must decode");
    expect(grep.id).toBe("grep");
    expect(ripgrep.id).toBe("ripgrep");
    expect(grep.ask).toEqual(ripgrep.ask);
  });

  test("a tool that is neither names no text ask", () => {
    expect(grepAsk({ pattern: "resolveTool" }, "shell")).toBeUndefined();
    expect(grepAsk({ command: "rg x" }, "grep")).toBeUndefined();
  });
});

describe("the guard's text rows", () => {
  test("a code-shaped grep reroutes and records the pattern", async () => {
    const bin = await makeBin(READY_BIN);
    await withBinary(bin, async () => {
      const { callback, asserts } = await captureGuard();
      const asked = toolEvent("grep", { pattern: "resolveTool" }, "ses_guard_grep", "call_guard_grep") as {
        tool: string;
        input: Record<string, unknown>;
      };
      await Effect.runPromise(callback(asked));
      expect(asked.tool).toBe("spectre_search");
      expect(asked.input["pattern"]).toBe("resolveTool");
      expect(memories.get(session("ses_guard_grep"))?.asked.get("resolveTool")).toEqual({ kind: "pending" });
      expect(asserts.map((one) => one.action)).toEqual(["grep", "read"]);
      rerouted.delete(Tool.CallID.make("call_guard_grep"));
      clean("ses_guard_grep");
    });
  });

  test("a code-shaped ripgrep reroutes", async () => {
    const bin = await makeBin(READY_BIN);
    await withBinary(bin, async () => {
      const { callback } = await captureGuard();
      const asked = toolEvent("ripgrep", { pattern: "resolveTool" }, "ses_guard_rg", "call_guard_rg") as {
        tool: string;
      };
      await Effect.runPromise(callback(asked));
      expect(asked.tool).toBe("spectre_search");
      rerouted.delete(Tool.CallID.make("call_guard_rg"));
      clean("ses_guard_rg");
    });
  });

  test("a plain-text path stays native", async () => {
    const bin = await makeBin(READY_BIN);
    await withBinary(bin, async () => {
      const { callback } = await captureGuard();
      const asked = toolEvent(
        "grep",
        { pattern: "resolveTool", path: "debug.log" },
        "ses_guard_plain",
        "call_guard_plain",
      ) as { tool: string };
      await Effect.runPromise(callback(asked));
      expect(asked.tool).toBe("grep");
      expect(memories.get(session("ses_guard_plain"))?.asked.size).toBe(0);
      clean("ses_guard_plain");
    });
  });

  test("a pattern the session already asked stays native", async () => {
    const bin = await makeBin(READY_BIN);
    await withBinary(bin, async () => {
      const { callback } = await captureGuard();
      const first = toolEvent("grep", { pattern: "resolveTool" }, "ses_guard_twice", "call_guard_first");
      await Effect.runPromise(callback(first));
      const second = toolEvent("grep", { pattern: "resolveTool" }, "ses_guard_twice", "call_guard_second") as {
        tool: string;
      };
      await Effect.runPromise(callback(second));
      expect(second.tool).toBe("grep");
      rerouted.delete(Tool.CallID.make("call_guard_first"));
      clean("ses_guard_twice");
    });
  });

  test("a too-broad pattern stays native", async () => {
    const bin = await makeBin(READY_BIN);
    await withBinary(bin, async () => {
      const { callback } = await captureGuard();
      const asked = toolEvent("grep", { pattern: "ab" }, "ses_guard_broad", "call_guard_broad") as { tool: string };
      await Effect.runPromise(callback(asked));
      expect(asked.tool).toBe("grep");
      clean("ses_guard_broad");
    });
  });

  test("an absent binary passes every row", async () => {
    const bin = `${tempDir()}/missing-ripwire`;
    await withBinary(bin, async () => {
      const { callback } = await captureGuard();
      const asked = toolEvent("grep", { pattern: "resolveTool" }, "ses_guard_absent", "call_guard_absent") as {
        tool: string;
      };
      await Effect.runPromise(callback(asked));
      expect(asked.tool).toBe("grep");
      clean("ses_guard_absent");
    });
  });

  test("a stale binary passes every row", async () => {
    const bin = await makeBin(`#!/bin/sh
echo "ripwire 0.1.0 (Release, built_from=test)"
`);
    await withBinary(bin, async () => {
      const { callback } = await captureGuard();
      const asked = toolEvent("grep", { pattern: "resolveTool" }, "ses_guard_stale", "call_guard_stale") as {
        tool: string;
      };
      await Effect.runPromise(callback(asked));
      expect(asked.tool).toBe("grep");
      clean("ses_guard_stale");
    });
  });

  test("a request that does not hold the search tool stays native", () => {
    const decision = decide(
      { surface: "text", id: "grep", ask: { pattern: "resolveTool" } },
      held({ search: false }),
      { health: ready, skill: true, parentID: false },
    );
    expect(decision.verdict).toEqual({ kind: "pass", why: "search-unavailable" });
  });
});

describe("the guard remembers every allow", () => {
  test("a non-reroute verdict persists the next memory through remember", async () => {
    const bin = await makeBin(READY_BIN);
    await withBinary(bin, async () => {
      const { callback } = await captureGuard();
      const name = "ses_guard_remember";
      memories.set(
        session(name),
        held({ mutation: 4, editedCode: new Set(["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"]) }),
      );
      await Effect.runPromise(
        callback(toolEvent("shell", { command: "ripwire . --quality-delta" }, name, "call_guard_remember")),
      );
      const after = memories.get(session(name));
      expect(after?.touched).toBe(1);
      expect(after?.measured.delta).toBe(4);
      clean(name);
    });
  });
});

describe("the guard's shell reroute", () => {
  test("a bare rg reroutes under the shell and read actions", async () => {
    const bin = await makeBin(READY_BIN);
    await withBinary(bin, async () => {
      const { callback, asserts } = await captureGuard();
      const asked = toolEvent(
        "shell",
        { command: "rg -n resolveTool src" },
        "ses_guard_shell",
        "call_guard_shell",
      ) as { tool: string; input: Record<string, unknown> };
      await Effect.runPromise(callback(asked));
      expect(asked.tool).toBe("spectre_search");
      expect(asked.input).toEqual({ pattern: "resolveTool", path: "src" });
      expect(asserts).toEqual([
        { action: "shell", resources: ["rg -n resolveTool src"] },
        { action: "read", resources: ["src"] },
      ]);
      rerouted.delete(Tool.CallID.make("call_guard_shell"));
      clean("ses_guard_shell");
    });
  });

  test("a pipe, a second path, an unknown flag and a plain-text path stay native", async () => {
    const bin = await makeBin(READY_BIN);
    await withBinary(bin, async () => {
      const { callback } = await captureGuard();
      for (const [index, command] of [
        "rg -n resolveTool src | head",
        "rg -n resolveTool src docs",
        "rg -g '*.ts' resolveTool",
        "rg -n ERROR app.log",
        "rg ab resolveTool",
      ].entries()) {
        const asked = toolEvent("shell", { command }, "ses_guard_native", `call_guard_native_${index}`) as {
          tool: string;
        };
        await Effect.runPromise(callback(asked));
        expect(asked.tool).toBe("shell");
      }
      clean("ses_guard_native");
    });
  });

  test("a shell grep reroutes like rg", async () => {
    const bin = await makeBin(READY_BIN);
    await withBinary(bin, async () => {
      const { callback } = await captureGuard();
      const asked = toolEvent(
        "shell",
        { command: "grep -rn resolveTool src" },
        "ses_guard_grep",
        "call_guard_grep_shell",
      ) as { tool: string };
      await Effect.runPromise(callback(asked));
      expect(asked.tool).toBe("spectre_search");
      rerouted.delete(Tool.CallID.make("call_guard_grep_shell"));
      clean("ses_guard_grep");
    });
  });

  test("a non-search command stays native", async () => {
    const bin = await makeBin(READY_BIN);
    await withBinary(bin, async () => {
      const { callback } = await captureGuard();
      const asked = toolEvent("shell", { command: "npm run typecheck" }, "ses_guard_other", "call_guard_other") as {
        tool: string;
      };
      await Effect.runPromise(callback(asked));
      expect(asked.tool).toBe("shell");
      clean("ses_guard_other");
    });
  });
});

describe("the guard's failure channel", () => {
  test("a plain permission decline is not swallowed, and records nothing", async () => {
    const bin = await makeBin(READY_BIN);
    await withBinary(bin, async () => {
      const { callback } = await captureGuard(() => Effect.die(new Error("declined")));
      const asked = toolEvent("grep", { pattern: "resolveTool" }, "ses_guard_decline", "call_guard_decline");
      const exit = await Effect.runPromiseExit(callback(asked));
      expect(Exit.isFailure(exit)).toBe(true);
      expect(memories.get(session("ses_guard_decline"))?.asked.size ?? 0).toBe(0);
      clean("ses_guard_decline");
    });
  });
});

describe("the applier depends on the reader", () => {
  test("the text reroute depends on the reader", async () => {
    const bin = await makeBin(READY_BIN);
    await withBinary(bin, async () => {
      const enforced = await captureGuard();
      const routed = toolEvent("grep", { pattern: "resolveTool" }, "ses_guard_reader_on", "call_guard_on") as {
        tool: string;
      };
      await Effect.runPromise(enforced.callback(routed));
      expect(routed.tool).toBe("spectre_search");

      const absent = await captureGuard(undefined, () => undefined);
      const kept = toolEvent("grep", { pattern: "resolveTool" }, "ses_guard_reader_off", "call_guard_off") as {
        tool: string;
      };
      await Effect.runPromise(absent.callback(kept));
      expect(kept.tool).toBe("grep");
      expect(memories.get(session("ses_guard_reader_off"))).toBeUndefined();

      rerouted.delete(Tool.CallID.make("call_guard_on"));
      clean("ses_guard_reader_on");
    });
  });

  test("the edit observation depends on the reader", async () => {
    const bin = await makeBin(READY_BIN);
    await withBinary(bin, async () => {
      const enforced = await captureGuard();
      await Effect.runPromise(
        enforced.callback(toolEvent("edit", { path: "src/retry.ts" }, "ses_guard_edit_on", "call_edit_on")),
      );
      expect(memories.get(session("ses_guard_edit_on"))?.mutation).toBe(1);

      const absent = await captureGuard(undefined, () => undefined);
      await Effect.runPromise(
        absent.callback(toolEvent("edit", { path: "src/retry.ts" }, "ses_guard_edit_off", "call_edit_off")),
      );
      expect(memories.get(session("ses_guard_edit_off"))).toBeUndefined();

      clean("ses_guard_edit_on");
    });
  });
});
