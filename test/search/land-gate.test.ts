import { afterEach, describe, expect, test } from "bun:test";
import { Session } from "@opencode/schema/session";
import { Effect, Exit } from "effect";
import { ripwire } from "../../tools/definitions/search";
import { envOf } from "../../tools/definitions/search/apply";
import { CONTRACT, END_OF_WORK, landRefusal } from "../../tools/definitions/search/contract";
import {
  contextRule,
  decide,
  type Health,
  type Memory,
  SPECTRE_DELETE_REFUSAL,
  shellParse,
} from "../../tools/definitions/search/policy";
import { shellAsk } from "../../tools/definitions/search/signals";
import { memories } from "../../tools/definitions/search/state";
import {
  captureGuard,
  cleanupDirs,
  makeBin,
  PROJECT,
  READY_BIN,
  readingContext,
  tempDir,
  toolContext,
  toolEvent,
  withBinary,
} from "./host";

/**
 * The landing gate: one refusal for a landing command after edits, until
 * `ripwire . --quality-delta` and `ripwire . --affected=` ran against the last
 * mutation. A doc-only tree, a spent gate and a fully measured tree pass.
 */

const ready: Health = { kind: "ready", binary: "/bin/ripwire", version: "0.7.0" };
const absent: Health = { kind: "absent", why: "ripwire is not on PATH" };

const held = (overrides?: Partial<Memory>): Memory => ({
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

const decideShell = (command: string, overrides?: Partial<Memory>, health: Health = ready) => {
  const ask = shellAsk({ command });
  if (ask === undefined) throw new Error("expected shell ask");
  return decide(ask, held(overrides), envOf(health));
};

describe("the landing command set", () => {
  const landings = [
    "git commit -m land",
    "git push",
    "git push --force-with-lease origin main",
    "gh pr create --title x --body y",
    "git merge feature",
    "git rebase --continue",
    "git add . && git commit -m land",
    "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=commit.gpgsign GIT_CONFIG_VALUE_0=false git commit -m land",
    'GIT_AUTHOR_NAME="Yago Riveiro" git commit -m land',
    "cd /tmp/repo && git push origin HEAD",
    "bun test && gh pr create --title x --body y",
    "echo land | git commit -F -",
    "true || git push",
    "git -C /tmp/repo commit -m land",
  ];

  for (const command of landings) {
    test(`${command} is a landing`, () => {
      expect(shellParse(command).kind).toBe("landing");
    });
  }

  test("git archaeology, quoted landing text, and a prefixed merge are not landings", () => {
    expect(shellParse("git status").kind).toBe("other");
    expect(shellParse("git merge-base main HEAD").kind).toBe("other");
    expect(shellParse("git commit-tree HEAD").kind).toBe("other");
    expect(shellParse('echo "git commit -m fake && git push"').kind).toBe("other");
  });

  test("recursive rm targeting .spectre or .spectre/brain is destructive and always refused", () => {
    for (const command of [
      "rm -rf .spectre",
      "rm -fr .spectre/brain",
      "cd repo && rm -r ./.spectre/",
      "FOO=1 rm --recursive /work/.spectre/brain",
    ]) {
      expect(shellParse(command).kind).toBe("destructive");
      const verdictReady = decideShell(command).verdict;
      const verdictAbsent = decideShell(command, undefined, absent).verdict;
      expect(verdictReady).toEqual({
        kind: "refuse",
        gate: "spectre",
        message: SPECTRE_DELETE_REFUSAL,
      });
      expect(verdictAbsent).toEqual(verdictReady);
    }
    expect(shellParse("rm .spectre/run.md").kind).toBe("other");
    expect(shellParse('echo "rm -rf .spectre"').kind).toBe("other");
  });
});

describe("decide, the context row above the landing", () => {
  const decideContext = (overrides?: Partial<Memory>) =>
    decide({ surface: "context", tools: ["spectre_search"] }, held(overrides), { health: ready });

  test("an unmeasured code edit carries the end-of-work nudge and the rule", () => {
    const decision = decideContext({ mutation: 2, editedCode: new Set(["src/retry.ts"]) });
    expect(decision.verdict.kind).toBe("prose");
    if (decision.verdict.kind !== "prose") throw new Error("expected prose");
    expect(decision.verdict.key).toBe("end-of-work");
    expect(decision.verdict.text).toContain(END_OF_WORK);
    expect(decision.verdict.text).toContain('tools.spectre.ripwire({ action: "check" })');
    expect(decision.verdict.text).toContain(CONTRACT.rule);
    expect(decision.next.search).toBe(true);
  });

  test("a clean tree and a fully measured tree carry the rule alone", () => {
    for (const memory of [
      {},
      { mutation: 2, editedCode: new Set(["src/retry.ts"]), measured: { delta: 1, affected: 1 } },
    ]) {
      const decision = decideContext(memory);
      if (decision.verdict.kind !== "prose") throw new Error("expected prose");
      expect(decision.verdict.key).toBe("rule");
      expect(decision.verdict.text).toBe(contextRule(ready));
    }
  });

  test("a doc edit alone never nudges", () => {
    const decision = decideContext({ mutation: 1, edited: new Set(["README.md"]) });
    if (decision.verdict.kind !== "prose") throw new Error("expected prose");
    expect(decision.verdict.key).toBe("rule");
  });

  test("a half measurement still carries the nudge", () => {
    const decision = decideContext({
      mutation: 2,
      editedCode: new Set(["src/retry.ts"]),
      measured: { delta: 1 },
    });
    if (decision.verdict.kind !== "prose") throw new Error("expected prose");
    expect(decision.verdict.key).toBe("end-of-work");
  });
});

describe("decide, the landing passes", () => {
  const code = new Set(["src/retry.ts"]);

  test("a tree with no code edit passes as nothing-edited", () => {
    expect(decideShell("git commit -m land").verdict).toEqual({
      kind: "pass",
      why: "nothing-edited",
    });
    expect(
      decideShell("git commit -m land", { mutation: 1, edited: new Set(["README.md"]) }).verdict,
    ).toEqual({
      kind: "pass",
      why: "nothing-edited",
    });
  });

  test("a spent gate passes the second call", () => {
    expect(
      decideShell("git commit -m land", { mutation: 2, editedCode: code, spent: new Set(["land"]) })
        .verdict,
    ).toEqual({ kind: "pass", why: "gate-spent" });
  });

  test("both measurements fresh passes as measured", () => {
    expect(
      decideShell("git push", {
        mutation: 2,
        editedCode: code,
        measured: { delta: 1, affected: 1 },
      }).verdict,
    ).toEqual({ kind: "pass", why: "measured" });
  });

  test("a measurement past the last code edit stays fresh", () => {
    expect(
      decideShell("git push", {
        mutation: 2,
        editedCode: code,
        measured: { delta: 3, affected: 4 },
      }).verdict,
    ).toEqual({ kind: "pass", why: "measured" });
  });

  test("a doc edit after a measurement does not invalidate it", () => {
    expect(
      decideShell("git push", {
        mutation: 3,
        edited: new Set(["src/retry.ts", "README.md"]),
        editedCode: code,
        measured: { delta: 1, affected: 1 },
      }).verdict,
    ).toEqual({ kind: "pass", why: "measured" });
  });

  test("an absent instrument passes as no-instrument", () => {
    expect(
      decideShell("git commit -m land", { mutation: 3, editedCode: code }, absent).verdict,
    ).toEqual({
      kind: "pass",
      why: "no-instrument",
    });
  });
});

describe("decide, the landing refusal", () => {
  test("code edits with neither measurement refuse and spend the gate", () => {
    const decision = decideShell("git commit -m land", {
      mutation: 2,
      editedCode: new Set(["src/retry.ts", "src/attach.ts"]),
    });
    expect(decision.verdict.kind).toBe("refuse");
    expect(decision.next.spent.has("land")).toBe(true);
  });

  test("a delta alone refuses", () => {
    expect(
      decideShell("git commit -m land", {
        mutation: 2,
        editedCode: new Set(["src/retry.ts"]),
        measured: { delta: 1 },
      }).verdict.kind,
    ).toBe("refuse");
  });

  test("an affected alone refuses", () => {
    expect(
      decideShell("git commit -m land", {
        mutation: 2,
        editedCode: new Set(["src/retry.ts"]),
        measured: { affected: 1 },
      }).verdict.kind,
    ).toBe("refuse");
  });

  test("a delta older than the last code edit refuses", () => {
    expect(
      decideShell("git commit -m land", {
        mutation: 3,
        editedCode: new Set(["src/a.ts", "src/b.ts", "src/c.ts"]),
        measured: { delta: 2, affected: 3 },
      }).verdict.kind,
    ).toBe("refuse");
  });

  test("the message names both measurements and the code paths it watched", () => {
    const decision = decideShell("git commit -m land", {
      mutation: 3,
      edited: new Set(["README.md", "src/retry.ts", "src/attach.ts"]),
      editedCode: new Set(["src/retry.ts", "src/attach.ts"]),
    });
    if (decision.verdict.kind !== "refuse") throw new Error("expected a refusal");
    expect(decision.verdict.message).toContain('tools.spectre.ripwire({ action: "check" })');
    expect(decision.verdict.message).toContain("ripwire . --quality-delta");
    expect(decision.verdict.message).toContain("ripwire . --affected=src/attach.ts,src/retry.ts");
    expect(decision.verdict.message).not.toContain("README.md");
    expect(decision.verdict.message).toContain("advisory by design");
  });
});

describe("landRefusal is deterministic", () => {
  test("the paths are sorted", () => {
    expect(landRefusal(["b.ts", "a.ts"])).toContain("--affected=a.ts,b.ts");
  });

  test("the empty set is defensive formatting, not a gate output", () => {
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
      await Effect.runPromise(
        callback(toolEvent("edit", { path: "src/retry.ts" }, name, "call_land_edit")),
      );
      expect(memories.get(Session.ID.make(name))?.mutation).toBe(1);
      expect(memories.get(Session.ID.make(name))?.editedCode.has("src/retry.ts")).toBe(true);

      const first = await Effect.runPromiseExit(
        callback(toolEvent("shell", { command: "git commit -m land" }, name, "call_land_first")),
      );
      expect(Exit.isFailure(first)).toBe(true);

      const second = toolEvent(
        "shell",
        { command: "git commit -m land" },
        name,
        "call_land_second",
      ) as {
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
      await Effect.runPromise(
        callback(toolEvent("edit", { path: "src/retry.ts" }, name, "call_land_m_edit")),
      );
      await Effect.runPromise(
        callback(
          toolEvent("shell", { command: "ripwire . --quality-delta" }, name, "call_land_delta"),
        ),
      );
      await Effect.runPromise(
        callback(
          toolEvent(
            "shell",
            { command: "ripwire . --affected=src/retry.ts" },
            name,
            "call_land_affected",
          ),
        ),
      );
      expect(memories.get(Session.ID.make(name))?.measured).toEqual({ delta: 1, affected: 1 });
      const asked = toolEvent("shell", { command: "git push" }, name, "call_land_push") as {
        tool: string;
      };
      const exit = await Effect.runPromiseExit(callback(asked));
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(asked.tool).toBe("shell");
      memories.delete(Session.ID.make(name));
    });
  });

  test("a doc edit and a commit pass the landing gate", async () => {
    const bin = await makeBin(READY_BIN);
    await withBinary(bin, async () => {
      const { callback } = await captureGuard();
      const name = "ses_land_doc";
      await Effect.runPromise(
        callback(toolEvent("edit", { path: "README.md" }, name, "call_land_doc_edit")),
      );
      expect(memories.get(Session.ID.make(name))?.mutation).toBe(1);
      expect(memories.get(Session.ID.make(name))?.editedCode.size).toBe(0);
      const commit = toolEvent(
        "shell",
        { command: "git commit -m docs" },
        name,
        "call_land_doc_commit",
      );
      const exit = await Effect.runPromiseExit(callback(commit));
      expect(Exit.isSuccess(exit)).toBe(true);
      memories.delete(Session.ID.make(name));
    });
  });

  test("a code edit after a measurement refuses until the measurement reruns", async () => {
    const bin = await makeBin(READY_BIN);
    await withBinary(bin, async () => {
      const { callback } = await captureGuard();
      const name = "ses_land_stale";
      await Effect.runPromise(
        callback(toolEvent("edit", { path: "src/retry.ts" }, name, "call_land_stale_one")),
      );
      await Effect.runPromise(
        callback(
          toolEvent(
            "shell",
            { command: "ripwire . --quality-delta" },
            name,
            "call_land_stale_delta",
          ),
        ),
      );
      await Effect.runPromise(
        callback(
          toolEvent(
            "shell",
            { command: "ripwire . --affected=src/retry.ts" },
            name,
            "call_land_stale_aff",
          ),
        ),
      );
      await Effect.runPromise(
        callback(toolEvent("edit", { path: "src/attach.ts" }, name, "call_land_stale_two")),
      );
      const commit = await Effect.runPromiseExit(
        callback(
          toolEvent("shell", { command: "git commit -m land" }, name, "call_land_stale_commit"),
        ),
      );
      expect(Exit.isFailure(commit)).toBe(true);
      memories.delete(Session.ID.make(name));
    });
  });

  test("a repeated edit to the same code file invalidates both shell ripwire and tools.spectre.ripwire freshness", async () => {
    const dir = tempDir();
    const bin = await makeBin(`#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "ripwire 0.7.0 (Release, built_from=test)"
  exit 0
fi
case "$*" in
  *"--quality-delta"*)
    printf '%s' '<quality-delta baseline="git-HEAD" regressions="0" gating="0" new-symbol="0" at="deadbeef"></quality-delta>'
    exit 0
    ;;
  *"--affected="*)
    printf '%s' '<affected><test p="test/retry.test.ts" hops="1"/></affected>'
    exit 0
    ;;
esac
exit 1
`);
    await withBinary(bin, async () => {
      const { callback } = await captureGuard();
      const shellSession = "ses_land_repeat_shell";
      await Effect.runPromise(
        callback(toolEvent("edit", { path: "src/retry.ts" }, shellSession, "call_rep_s_1")),
      );
      await Effect.runPromise(
        callback(
          toolEvent(
            "shell",
            { command: "ripwire . --quality-delta && ripwire . --affected=src/retry.ts" },
            shellSession,
            "call_rep_s_meas",
          ),
        ),
      );
      expect(memories.get(Session.ID.make(shellSession))?.measured).toEqual({
        delta: 1,
        affected: 1,
      });

      await Effect.runPromise(
        callback(toolEvent("edit", { path: "src/retry.ts" }, shellSession, "call_rep_s_2")),
      );
      expect(memories.get(Session.ID.make(shellSession))?.editedCode.size).toBe(1);
      expect(memories.get(Session.ID.make(shellSession))?.codeMutation).toBe(2);

      const shellCommit = await Effect.runPromiseExit(
        callback(
          toolEvent(
            "shell",
            { command: "git add . && git commit -m land" },
            shellSession,
            "call_rep_s_commit",
          ),
        ),
      );
      expect(Exit.isFailure(shellCommit)).toBe(true);
      memories.delete(Session.ID.make(shellSession));

      const toolSession = "ses_land_repeat_tool";
      await Effect.runPromise(
        callback(toolEvent("edit", { path: "src/retry.ts" }, toolSession, "call_rep_t_1")),
      );
      await Effect.runPromise(
        ripwire(readingContext(PROJECT, new Map(), dir)).execute(
          { action: "check" },
          toolContext(toolSession),
        ),
      );
      expect(memories.get(Session.ID.make(toolSession))?.measured).toEqual({
        delta: 1,
        affected: 1,
      });

      await Effect.runPromise(
        callback(toolEvent("edit", { path: "src/retry.ts" }, toolSession, "call_rep_t_2")),
      );
      const toolCommit = await Effect.runPromiseExit(
        callback(
          toolEvent(
            "shell",
            { command: "GIT_CONFIG_COUNT=1 git commit -m land" },
            toolSession,
            "call_rep_t_commit",
          ),
        ),
      );
      expect(Exit.isFailure(toolCommit)).toBe(true);
      memories.delete(Session.ID.make(toolSession));
    });
  });

  test("the refusal depends on the reader", async () => {
    const bin = await makeBin(READY_BIN);
    await withBinary(bin, async () => {
      const enforced = await captureGuard();
      await Effect.runPromise(
        enforced.callback(
          toolEvent("edit", { path: "src/retry.ts" }, "ses_land_reader_on", "call_land_on_edit"),
        ),
      );
      const refused = await Effect.runPromiseExit(
        enforced.callback(
          toolEvent(
            "shell",
            { command: "git commit -m land" },
            "ses_land_reader_on",
            "call_land_on",
          ),
        ),
      );
      expect(Exit.isFailure(refused)).toBe(true);

      const absent = await captureGuard(undefined, () => undefined);
      const passed = await Effect.runPromiseExit(
        absent.callback(
          toolEvent(
            "shell",
            { command: "git commit -m land" },
            "ses_land_reader_off",
            "call_land_off",
          ),
        ),
      );
      expect(Exit.isSuccess(passed)).toBe(true);
      expect(memories.get(Session.ID.make("ses_land_reader_off"))).toBeUndefined();
      memories.delete(Session.ID.make("ses_land_reader_on"));
    });
  });
});
