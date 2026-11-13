import { afterEach, describe, expect, test } from "bun:test";
import { Session } from "@opencode/schema/session";
import { Effect, Exit } from "effect";
import { CONTRACT, END_OF_WORK, landRefusal } from "../../tools/definitions/search/contract";
import { decide, type Health, type Memory, shellParse } from "../../tools/definitions/search/policy";
import { memories } from "../../tools/definitions/search/state";
import { captureGuard, cleanupDirs, makeBin, READY_BIN, toolEvent, withBinary } from "./host";

/**
 * The landing gate: one refusal for a landing command after edits, until
 * `ripwire . --quality-delta` and `ripwire . --affected=` ran against the last
 * mutation. A doc-only tree, a spent gate and a fully measured tree pass.
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
  mutation: 0,
  measured: {},
  spent: new Set(),
  subagents: 0,
  ...overrides,
});

const shell = (command: string, overrides?: Partial<Memory>, health: Health = ready) =>
  decide(
    { surface: "shell", command, parsed: shellParse(command) },
    held(overrides),
    { health, skill: true, parentID: false },
  );

describe("the landing command set", () => {
  const landings = [
    "git commit -m land",
    "git push",
    "git push --force-with-lease origin main",
    "gh pr create --title x --body y",
    "git merge feature",
    "git rebase --continue",
  ];

  for (const command of landings) {
    test(`${command} is a landing`, () => {
      expect(shellParse(command).kind).toBe("landing");
    });
  }

  test("git archaeology and a prefixed merge are not landings", () => {
    expect(shellParse("git status").kind).toBe("other");
    expect(shellParse("git merge-base main HEAD").kind).toBe("other");
    expect(shellParse("git commit-tree HEAD").kind).toBe("other");
  });
});

describe("decide, the context row above the landing", () => {
  const context = (overrides?: Partial<Memory>) =>
    decide(
      { surface: "context", tools: ["spectre_search"] },
      held(overrides),
      { health: ready, skill: true, parentID: false },
    );

  test("an unmeasured edit carries the end-of-work nudge and the rule", () => {
    const decision = context({ mutation: 2 });
    expect(decision.verdict.kind).toBe("prose");
    if (decision.verdict.kind !== "prose") throw new Error("expected prose");
    expect(decision.verdict.key).toBe("end-of-work");
    expect(decision.verdict.text).toContain(END_OF_WORK);
    expect(decision.verdict.text).toContain(CONTRACT.rule);
    expect(decision.next.search).toBe(true);
  });

  test("a clean tree and a fully measured tree carry the rule alone", () => {
    for (const memory of [{}, { mutation: 2, measured: { delta: 2, affected: 2 } }]) {
      const decision = context(memory);
      if (decision.verdict.kind !== "prose") throw new Error("expected prose");
      expect(decision.verdict.key).toBe("rule");
      expect(decision.verdict.text).toBe(CONTRACT.rule);
    }
  });

  test("a half measurement still carries the nudge", () => {
    const decision = context({ mutation: 2, measured: { delta: 3 } });
    if (decision.verdict.kind !== "prose") throw new Error("expected prose");
    expect(decision.verdict.key).toBe("end-of-work");
  });
});

describe("decide, the landing passes", () => {
  test("a doc-only tree passes as nothing-edited", () => {
    expect(shell("git commit -m land").verdict).toEqual({ kind: "pass", why: "nothing-edited" });
  });

  test("a spent gate passes the second call", () => {
    expect(shell("git commit -m land", { mutation: 2, spent: new Set(["land"]) }).verdict).toEqual({
      kind: "pass",
      why: "gate-spent",
    });
  });

  test("both measurements fresh passes as measured", () => {
    expect(shell("git push", { mutation: 2, measured: { delta: 2, affected: 2 } }).verdict).toEqual({
      kind: "pass",
      why: "measured",
    });
  });

  test("a measurement past the last mutation stays fresh", () => {
    expect(shell("git push", { mutation: 2, measured: { delta: 3, affected: 4 } }).verdict).toEqual({
      kind: "pass",
      why: "measured",
    });
  });

  test("an absent instrument passes as no-instrument", () => {
    expect(shell("git commit -m land", { mutation: 3 }, absent).verdict).toEqual({
      kind: "pass",
      why: "no-instrument",
    });
  });
});

describe("decide, the landing refusal", () => {
  test("edits with neither measurement refuse and spend the gate", () => {
    const decision = shell("git commit -m land", {
      mutation: 2,
      edited: new Set(["src/retry.ts", "src/attach.ts"]),
    });
    expect(decision.verdict.kind).toBe("refuse");
    expect(decision.next.spent.has("land")).toBe(true);
  });

  test("a delta alone refuses", () => {
    expect(shell("git commit -m land", { mutation: 2, measured: { delta: 2 } }).verdict.kind).toBe("refuse");
  });

  test("an affected alone refuses", () => {
    expect(shell("git commit -m land", { mutation: 2, measured: { affected: 2 } }).verdict.kind).toBe("refuse");
  });

  test("a delta older than the last mutation refuses", () => {
    expect(
      shell("git commit -m land", { mutation: 3, measured: { delta: 2, affected: 3 } }).verdict.kind,
    ).toBe("refuse");
  });

  test("the message names both measurements and the paths it watched", () => {
    const decision = shell("git commit -m land", {
      mutation: 2,
      edited: new Set(["src/retry.ts", "src/attach.ts"]),
    });
    if (decision.verdict.kind !== "refuse") throw new Error("expected a refusal");
    expect(decision.verdict.message).toContain("ripwire . --quality-delta");
    expect(decision.verdict.message).toContain("ripwire . --affected=src/attach.ts,src/retry.ts");
    expect(decision.verdict.message).toContain("refuses once");
  });
});

describe("landRefusal is deterministic", () => {
  test("the paths are sorted", () => {
    expect(landRefusal(["b.ts", "a.ts"])).toContain("--affected=a.ts,b.ts");
  });

  test("an empty set names the root", () => {
    expect(landRefusal([])).toContain("--affected=.");
  });
});

afterEach(cleanupDirs);

describe("the landing gate on the host", () => {
  test("an edit raises the mutation, a commit refuses once, and the second commit passes", async () => {
    const bin = await makeBin(READY_BIN);
    await withBinary(bin, async () => {
      const { callback } = await captureGuard();
      const name = "ses_land_gate";
      await Effect.runPromise(callback(toolEvent("edit", { path: "src/retry.ts" }, name, "call_land_edit")));
      expect(memories.get(Session.ID.make(name))?.mutation).toBe(1);
      expect(memories.get(Session.ID.make(name))?.edited.has("src/retry.ts")).toBe(true);

      const first = await Effect.runPromiseExit(
        callback(toolEvent("shell", { command: "git commit -m land" }, name, "call_land_first")),
      );
      expect(Exit.isFailure(first)).toBe(true);

      const second = toolEvent("shell", { command: "git commit -m land" }, name, "call_land_second") as {
        tool: string;
      };
      await Effect.runPromise(callback(second));
      expect(second.tool).toBe("shell");
      memories.delete(Session.ID.make(name));
    });
  });

  test("a measured tree lets the commit through", async () => {
    const bin = await makeBin(READY_BIN);
    await withBinary(bin, async () => {
      const { callback } = await captureGuard();
      const name = "ses_land_measured";
      await Effect.runPromise(callback(toolEvent("edit", { path: "src/retry.ts" }, name, "call_land_m_edit")));
      await Effect.runPromise(
        callback(toolEvent("shell", { command: "ripwire . --quality-delta" }, name, "call_land_delta")),
      );
      await Effect.runPromise(
        callback(
          toolEvent("shell", { command: "ripwire . --affected=src/retry.ts" }, name, "call_land_affected"),
        ),
      );
      const asked = toolEvent("shell", { command: "git push" }, name, "call_land_push") as { tool: string };
      const exit = await Effect.runPromiseExit(callback(asked));
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(asked.tool).toBe("shell");
      memories.delete(Session.ID.make(name));
    });
  });
});
