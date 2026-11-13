import { afterEach, describe, expect, test } from "bun:test";
import { Session } from "@opencode/schema/session";
import type { Tool } from "@opencode/schema/tool";
import { Effect, Exit } from "effect";
import { readRefusal } from "../../tools/definitions/search/contract";
import { decide, type Health, type Memory } from "../../tools/definitions/search/policy";
import { readAsk } from "../../tools/definitions/search/signals";
import { memories } from "../../tools/definitions/search/state";
import { captureGuard, cleanupDirs, makeBin, READY_BIN, toolEvent, withBinary } from "./host";

/**
 * The read gate: the first code-file read with no ripwire call in the session
 * refuses once, and the second call is native. A doc, a config, a directory, a
 * skill body and a path outside the root all pass as `not-code` or
 * `outside-root`. A refused read does not count as a pass, so `already-read`
 * means a read after a pass, and the post-refusal pass is `gate-spent`.
 */

const ready: Health = { kind: "ready", binary: "/bin/ripwire", version: "0.6.10" };
const absent: Health = { kind: "absent", why: "ripwire is not on PATH" };

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

const read = (overrides?: Partial<Memory>, health: Health = ready) =>
  decide(
    { surface: "read", path: "src/retry.ts", code: true, insideRoot: true },
    held(overrides),
    { health, skill: true, parentID: false },
  );

describe("readAsk separates a code read from a prompt asset", () => {
  test("a code file inside the root is code", () => {
    expect(readAsk({ path: "src/retry.ts" }, "/work/project")).toEqual({
      surface: "read",
      path: "src/retry.ts",
      code: true,
      insideRoot: true,
    });
  });

  test("a README, a config and a directory are not code", () => {
    expect(readAsk({ path: "README.md" }, "/work/project")?.code).toBe(false);
    expect(readAsk({ path: "package.json" }, "/work/project")?.code).toBe(false);
    expect(readAsk({ path: "tsconfig.json" }, "/work/project")?.code).toBe(false);
    expect(readAsk({ path: "src" }, "/work/project")?.code).toBe(false);
  });

  test("a skill body is not-code, read the same way as a README", () => {
    expect(readAsk({ path: "skill://ripwire/SKILL.md" }, "/work/project")?.code).toBe(false);
    expect(readAsk({ path: "skill://x/fake.ts" }, "/work/project")?.code).toBe(false);
  });

  test("a path outside the root is outside", () => {
    expect(readAsk({ path: "../outside/retry.ts" }, "/work/project")?.insideRoot).toBe(false);
    expect(readAsk({ path: "/etc/passwd" }, "/work/project")?.insideRoot).toBe(false);
  });
});

describe("decide, the read passes", () => {
  test("not-code and outside-root pass without counting", () => {
    expect(
      decide(
        { surface: "read", path: "README.md", code: false, insideRoot: true },
        held(),
        { health: ready, skill: true, parentID: false },
      ).verdict,
    ).toEqual({ kind: "pass", why: "not-code" });
    expect(
      decide(
        { surface: "read", path: "skill://x/fake.ts", code: false, insideRoot: true },
        held(),
        { health: ready, skill: true, parentID: false },
      ).verdict,
    ).toEqual({ kind: "pass", why: "not-code" });
    expect(
      decide(
        { surface: "read", path: "../x.ts", code: true, insideRoot: false },
        held(),
        { health: ready, skill: true, parentID: false },
      ).verdict,
    ).toEqual({ kind: "pass", why: "outside-root" });
  });

  test("a used, read, edited or spent session counts the read and passes", () => {
    expect(read({ touched: 1 }).verdict).toEqual({ kind: "pass", why: "already-used" });
    expect(read({ reads: 1 }).verdict).toEqual({ kind: "pass", why: "already-read" });
    expect(read({ edited: new Set(["src/retry.ts"]) }).verdict).toEqual({
      kind: "pass",
      why: "already-edit",
    });
    expect(read({ spent: new Set(["read"]) }).verdict).toEqual({ kind: "pass", why: "gate-spent" });
    expect(read({ touched: 1 }).next.reads).toBe(1);
  });

  test("an absent instrument passes as no-instrument", () => {
    expect(read(undefined, absent).verdict).toEqual({ kind: "pass", why: "no-instrument" });
    expect(read(undefined, absent).next.spent.has("read")).toBe(false);
  });
});

describe("decide, the read refusal", () => {
  test("a first code read with no lookup refuses and spends the gate", () => {
    const decision = read();
    expect(decision.verdict).toEqual({
      kind: "refuse",
      gate: "read",
      message: readRefusal("src/retry.ts"),
    });
    expect(decision.next.spent.has("read")).toBe(true);
    expect(decision.next.reads).toBe(0);
  });

  test("the message names the instrument a reader reaches for", () => {
    const decision = read();
    if (decision.verdict.kind !== "refuse") throw new Error("expected a refusal");
    expect(decision.verdict.message).toContain("spectre_search");
    expect(decision.verdict.message).toContain("src/retry.ts");
    expect(decision.verdict.message).toContain("refuses once");
  });

  test("the second call passes after the gate is spent", () => {
    expect(read({ spent: new Set(["read"]) }).verdict).toEqual({ kind: "pass", why: "gate-spent" });
  });
});

const capture = async (): Promise<((event: unknown) => Effect.Effect<void, Tool.Error>)> =>
  (await captureGuard()).callback;

const readEvent = (session: string, id: string): unknown =>
  toolEvent("read", { path: "src/retry.ts" }, session, id);

describe("the read gate on the host", () => {
  test("the first code read fails once, and the second call completes", async () => {
    const bin = await makeBin(READY_BIN);
    await withBinary(bin, async () => {
      const callback = await capture();
      const first = await Effect.runPromiseExit(callback(readEvent("ses_read_gate", "call_read_first")));
      expect(Exit.isFailure(first)).toBe(true);
      const asked = readEvent("ses_read_gate", "call_read_second") as { tool: string };
      await Effect.runPromise(callback(asked));
      expect(asked.tool).toBe("read");
      memories.delete(Session.ID.make("ses_read_gate"));
    });
  });

  test("the README read completes without spending the gate", async () => {
    const bin = await makeBin(READY_BIN);
    await withBinary(bin, async () => {
      const callback = await capture();
      const asked = toolEvent("read", { path: "README.md" }, "ses_read_doc", "call_read_doc");
      const exit = await Effect.runPromiseExit(callback(asked));
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(memories.get(Session.ID.make("ses_read_doc"))?.spent.has("read")).toBe(false);
      memories.delete(Session.ID.make("ses_read_doc"));
    });
  });

  test("the refusal depends on the reader", async () => {
    const bin = await makeBin(READY_BIN);
    await withBinary(bin, async () => {
      const enforced = await captureGuard();
      const refused = await Effect.runPromiseExit(
        enforced.callback(readEvent("ses_read_absent_enforced", "call_read_absent_one")),
      );
      expect(Exit.isFailure(refused)).toBe(true);

      const absent = await captureGuard(undefined, () => undefined);
      const passed = await Effect.runPromiseExit(
        absent.callback(readEvent("ses_read_absent_off", "call_read_absent_two")),
      );
      expect(Exit.isSuccess(passed)).toBe(true);
      expect(memories.get(Session.ID.make("ses_read_absent_off"))).toBeUndefined();
      memories.delete(Session.ID.make("ses_read_absent_enforced"));
    });
  });
});
