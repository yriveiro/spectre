import { afterEach, describe, expect, test } from "bun:test";
import { Session } from "@opencode/schema/session";
import { Effect } from "effect";
import { recordsOf } from "../../tools/definitions/search/measure";
import { memories, memoryOf } from "../../tools/definitions/search/state";
import {
  type After,
  afterEvent,
  captureAfter,
  captureGuard,
  cleanupDirs,
  failedEvent,
  makeBin,
  makeStorage,
  READY_BIN,
  toolEvent,
  withBinary,
} from "./host";

/**
 * The usage record: one row per session, written on `tool.execute.after`, capped
 * at 64 and pruned by oldest. A completed search is a lookup and resolves its
 * `asked` entry, which is the fact that rescues the first code read after it.
 */

const records = async (after: After) =>
  Effect.runPromise(recordsOf(makeStorage(after.values), after.project));

const stored = (after: After, session: string) =>
  records(after).then((all) => all.find((one) => one.session === session));

const search = (after: After, session: string, id: string, status: string) =>
  Effect.runPromise(after.callback(afterEvent("spectre_search", { query: "decide" }, session, id, { status })));

afterEach(cleanupDirs);

describe("the record is written on execute.after", () => {
  test("an edit and a write count, and a command that is neither writes nothing", async () => {
    const bin = await makeBin(READY_BIN);
    await withBinary(bin, async () => {
      const after = await captureAfter();
      const name = "ses_measure_edit";

      await Effect.runPromise(after.callback(afterEvent("edit", { path: "src/a.ts" }, name, "call_m_edit")));
      await Effect.runPromise(
        after.callback(afterEvent("write", { path: "src/b.ts", content: "x" }, name, "call_m_write")),
      );
      await Effect.runPromise(after.callback(afterEvent("shell", { command: "git status" }, name, "call_m_other")));

      expect((await stored(after, name))?.edits).toBe(2);
      expect((await records(after)).length).toBe(1);
      memories.delete(Session.ID.make(name));
    });
  });

  test("a code read is counted, and a doc read is not", async () => {
    const bin = await makeBin(READY_BIN);
    await withBinary(bin, async () => {
      const after = await captureAfter();
      const name = "ses_measure_read";

      await Effect.runPromise(
        after.callback(afterEvent("read", { path: "/tmp/src/decide.ts" }, name, "call_m_code")),
      );
      await Effect.runPromise(after.callback(afterEvent("read", { path: "/tmp/README.md" }, name, "call_m_doc")));
      await Effect.runPromise(after.callback(afterEvent("read", { path: "/elsewhere/x.ts" }, name, "call_m_out")));

      expect((await stored(after, name))?.reads).toBe(1);
      memories.delete(Session.ID.make(name));
    });
  });

  test("an errored call writes nothing", async () => {
    const bin = await makeBin(READY_BIN);
    await withBinary(bin, async () => {
      const after = await captureAfter();
      const name = "ses_measure_failed";

      await Effect.runPromise(after.callback(afterEvent("edit", { path: "src/a.ts" }, name, "call_m_ok")));
      await Effect.runPromise(
        after.callback(failedEvent("edit", { path: "src/b.ts" }, name, "call_m_failed")),
      );

      const all = await records(after);
      expect(all.length).toBe(1);
      expect(all[0]?.session).toBe(name);
      expect(all[0]?.edits).toBe(1);
      memories.delete(Session.ID.make(name));
    });
  });

  test("the 65th session drops the oldest row", async () => {
    const bin = await makeBin(READY_BIN);
    await withBinary(bin, async () => {
      const after = await captureAfter();
      for (let index = 0; index < 65; index += 1) {
        const name = `ses_measure_cap_${index}`;
        await Effect.runPromise(after.callback(afterEvent("edit", { path: "src/a.ts" }, name, `call_m_cap_${index}`)));
        memories.delete(Session.ID.make(name));
      }
      const all = await records(after);
      expect(all.length).toBe(64);
      expect(all.some((one) => one.session === "ses_measure_cap_0")).toBe(false);
      expect(all.some((one) => one.session === "ses_measure_cap_64")).toBe(true);
    });
  });

  test("a second project reads none of the first project's rows", async () => {
    const bin = await makeBin(READY_BIN);
    await withBinary(bin, async () => {
      const after = await captureAfter("prj_measure_a");
      await Effect.runPromise(
        after.callback(afterEvent("edit", { path: "src/a.ts" }, "ses_measure_scope", "call_m_scope")),
      );
      const other = await Effect.runPromise(recordsOf(makeStorage(after.values), "prj_measure_b"));
      expect(other).toEqual([]);
      expect((await records(after)).length).toBe(1);
      memories.delete(Session.ID.make("ses_measure_scope"));
    });
  });
});

describe("a completed search is a lookup", () => {
  test("it counts, records its last outcome, and resolves the pattern it asked", async () => {
    const bin = await makeBin(READY_BIN);
    await withBinary(bin, async () => {
      const after = await captureAfter();
      const name = "ses_measure_search";
      await Effect.runPromise(
        after.callback(
          afterEvent(
            "spectre_search",
            { pattern: "resolveTool" },
            name,
            "call_m_search",
            { status: "answered" },
          ),
        ),
      );

      const memory = memories.get(Session.ID.make(name));
      expect(memory?.touched).toBe(1);
      expect(memory?.asked.get("resolveTool")).toEqual({ kind: "answered", outcome: "answered" });
      expect((await stored(after, name))?.lookups).toBe(1);
      expect((await stored(after, name))?.outcome).toBe("answered");
      memories.delete(Session.ID.make(name));
    });
  });

  test("a refused answer still counts the reach and resolves the ask", async () => {
    const bin = await makeBin(READY_BIN);
    await withBinary(bin, async () => {
      const after = await captureAfter();
      const name = "ses_measure_refused";
      await search(after, name, "call_m_refused", "refused");

      const memory = memories.get(Session.ID.make(name));
      expect(memory?.touched).toBe(1);
      expect(memory?.asked.get("decide")).toEqual({ kind: "answered", outcome: "refused" });
      expect((await stored(after, name))?.lookups).toBe(1);
      expect((await stored(after, name))?.outcome).toBe("refused");
      memories.delete(Session.ID.make(name));
    });
  });

  test("a search passes the next code read as already-used", async () => {
    const bin = await makeBin(READY_BIN);
    await withBinary(bin, async () => {
      const after = await captureAfter();
      const name = "ses_measure_rescue";
      await search(after, name, "call_m_rescue", "answered");
      expect(memoryOf(Session.ID.make(name)).touched).toBe(1);

      const { callback } = await captureGuard();
      await Effect.runPromise(
        callback(toolEvent("read", { path: "/tmp/src/decide.ts" }, name, "call_m_rescue_read")),
      );

      const memory = memories.get(Session.ID.make(name));
      expect(memory?.reads).toBe(1);
      expect(memory?.spent.has("read")).toBe(false);
      memories.delete(Session.ID.make(name));
    });
  });
});

describe("a ripwire lookup records its measurement", () => {
  test("a delta after two edits records the edit count it ran at", async () => {
    const bin = await makeBin(READY_BIN);
    await withBinary(bin, async () => {
      const after = await captureAfter();
      const name = "ses_measure_delta";
      await Effect.runPromise(after.callback(afterEvent("edit", { path: "src/a.ts" }, name, "call_m_d1")));
      await Effect.runPromise(after.callback(afterEvent("edit", { path: "src/b.ts" }, name, "call_m_d2")));
      await Effect.runPromise(
        after.callback(
          afterEvent("shell", { command: "ripwire . --quality-delta" }, name, "call_m_delta", {
            output: "clean",
          }),
        ),
      );

      const row = await stored(after, name);
      expect(row?.edits).toBe(2);
      expect(row?.lookups).toBe(1);
      expect(row?.measured.delta).toBe(2);
      expect(row?.measured.affected).toBeUndefined();
      memories.delete(Session.ID.make(name));
    });
  });

  test("a help call is recorded and is not a lookup", async () => {
    const bin = await makeBin(READY_BIN);
    await withBinary(bin, async () => {
      const after = await captureAfter();
      const name = "ses_measure_help";
      await Effect.runPromise(after.callback(afterEvent("shell", { command: "ripwire --help" }, name, "call_m_help")));

      const row = await stored(after, name);
      expect(row?.lookups).toBe(0);
      expect(row?.measured).toEqual({});
      memories.delete(Session.ID.make(name));
    });
  });
});

describe("a spawn is counted and a follow-up is not", () => {
  test("a spawn increments Memory.subagents and seeds the child's parent", async () => {
    const bin = await makeBin(READY_BIN);
    await withBinary(bin, async () => {
      const after = await captureAfter();
      const name = "ses_measure_spawn";
      await Effect.runPromise(
        after.callback(
          afterEvent("subagent", { agent: "explore", prompt: "x" }, name, "call_m_spawn", {
            sessionID: "ses_measure_child",
            status: "completed",
            output: "done",
          }),
        ),
      );

      expect(memoryOf(Session.ID.make(name)).subagents).toBe(1);
      expect((await stored(after, name))?.subagents).toBe(1);
      const child = await stored(after, "ses_measure_child");
      expect(child?.parent).toBe(name);
      expect(child?.edits).toBe(0);
      memories.delete(Session.ID.make(name));
    });
  });

  test("a follow-up names a child and is not a spawn", async () => {
    const bin = await makeBin(READY_BIN);
    await withBinary(bin, async () => {
      const after = await captureAfter();
      const name = "ses_measure_follow";
      const child = "ses_measure_follow_child";

      await Effect.runPromise(
        after.callback(
          afterEvent("subagent", { agent: "explore", prompt: "x" }, name, "call_m_follow_spawn", {
            sessionID: child,
            status: "completed",
            output: "done",
          }),
        ),
      );
      expect(memoryOf(Session.ID.make(name)).subagents).toBe(1);

      await Effect.runPromise(
        after.callback(
          afterEvent("subagent", { sessionID: child, prompt: "more" }, name, "call_m_follow", {
            sessionID: child,
            status: "completed",
            output: "more",
          }),
        ),
      );

      expect(memoryOf(Session.ID.make(name)).subagents).toBe(1);
      expect((await stored(after, name))?.subagents).toBe(1);
      expect((await records(after)).length).toBe(2);
      expect((await stored(after, child))?.parent).toBe(name);
      memories.delete(Session.ID.make(name));
    });
  });
});
