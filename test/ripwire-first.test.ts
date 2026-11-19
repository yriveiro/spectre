import { afterEach, describe, expect, test } from "bun:test";
import { type Plugin, Tool } from "@opencode/plugin/effect";
import { Session } from "@opencode/schema/session";
import { Effect, Exit, type Schema } from "effect";
import { attachSearch, ripwire } from "../tools/definitions/search";
import { endOfWorkSynced } from "../tools/definitions/search/apply";
import { END_OF_WORK } from "../tools/definitions/search/contract";
import { contextRule } from "../tools/definitions/search/policy";
import { memories, rerouted } from "../tools/definitions/search/state";
import {
  afterEvent,
  captureAfter,
  captureContext,
  captureGuard,
  cleanupDirs,
  forget,
  locationOf,
  makeBin,
  makeStorage,
  PROJECT,
  READY_BIN,
  readingContext,
  tempDir,
  toolContext,
  toolEvent,
  withBinary,
} from "./search/host";

const session = (name: string): Session.ID => Session.ID.make(name);

interface ContextEvent {
  readonly sessionID: Session.ID;
  readonly agent: string;
  system: Array<{ type: "text"; text: string }>;
  tools: Record<string, { description: string; input: unknown }>;
}

const contextEvent = (name: string): ContextEvent => ({
  sessionID: session(name),
  agent: "spectre",
  system: [],
  tools: { spectre_search: { description: "search", input: {} } },
});

afterEach(cleanupDirs);

describe("ready context carries moment cues while native context carries none", () => {
  test("a ready Spectre session appends the compact moment cues to CONTRACT.rule", async () => {
    const bin = await makeBin(READY_BIN);
    await withBinary(bin, async () => {
      const context = await captureContext();
      const draft = contextEvent("ses_context_ready");
      await Effect.runPromise(context(draft));

      const text = draft.system.at(-1)?.text ?? "";
      expect(text).toBe(contextRule({ kind: "ready", binary: bin, version: "0.6.10" }));
      expect(text).toContain("--exemplar=");
      expect(text).toContain("--impact=");
      expect(text).toContain("--pack-task=");
      expect(text).toContain("--stray-content");
      expect(text).toContain('tools.spectre.ripwire({ action: "check" })');
      expect(text).not.toContain("this session is native");

      forget("ses_context_ready");
    });
  });
});

describe("a code-shaped text search moves to spectre_search", () => {
  test("grep and ripgrep reroute, a plain-text path stays, and one pattern is asked once", async () => {
    const bin = await makeBin(READY_BIN);
    await withBinary(bin, async () => {
      const { callback } = await captureGuard();

      const grep = toolEvent("grep", { pattern: "resolveTool" }, "ses_text_grep", "call_text_grep");
      await Effect.runPromise(callback(grep));
      expect(grep.tool).toBe("spectre_search");
      expect(grep.input).toEqual({ pattern: "resolveTool" });

      const ripgrep = toolEvent("ripgrep", { pattern: "attachGuard" }, "ses_text_ripgrep", "call_text_ripgrep");
      await Effect.runPromise(callback(ripgrep));
      expect(ripgrep.tool).toBe("spectre_search");
      expect(ripgrep.input).toEqual({ pattern: "attachGuard" });

      const plain = toolEvent(
        "grep",
        { pattern: "resolveTool", path: "debug.log" },
        "ses_text_plain",
        "call_text_plain",
      );
      await Effect.runPromise(callback(plain));
      expect(plain.tool).toBe("grep");
      expect(memories.get(session("ses_text_plain"))?.asked.size).toBe(0);

      const again = toolEvent("grep", { pattern: "resolveTool" }, "ses_text_grep", "call_text_again");
      await Effect.runPromise(callback(again));
      expect(again.tool).toBe("grep");

      rerouted.delete(Tool.CallID.make("call_text_grep"));
      rerouted.delete(Tool.CallID.make("call_text_ripgrep"));
      forget("ses_text_grep", "ses_text_ripgrep", "ses_text_plain");
    });
  });
});

describe("a bare shell search moves and a decline reaches the host", () => {
  test("rg and git grep reroute under the shell and read actions", async () => {
    const bin = await makeBin(READY_BIN);
    await withBinary(bin, async () => {
      const { callback, asserts } = await captureGuard();

      const rg = toolEvent("shell", { command: "rg -n resolveTool src" }, "ses_shell_rg", "call_shell_rg");
      await Effect.runPromise(callback(rg));
      expect(rg.tool).toBe("spectre_search");
      expect(rg.input).toEqual({ pattern: "resolveTool", path: "src" });

      const git = toolEvent(
        "shell",
        { command: "git grep -n attachGuard -- src" },
        "ses_shell_git",
        "call_shell_git",
      );
      await Effect.runPromise(callback(git));
      expect(git.tool).toBe("spectre_search");
      expect(git.input).toEqual({ pattern: "attachGuard", path: "src" });

      expect(asserts).toEqual([
        { action: "shell", resources: ["rg -n resolveTool src"] },
        { action: "read", resources: ["src"] },
        { action: "shell", resources: ["git grep -n attachGuard -- src"] },
        { action: "read", resources: ["src"] },
      ]);

      rerouted.delete(Tool.CallID.make("call_shell_rg"));
      rerouted.delete(Tool.CallID.make("call_shell_git"));
      forget("ses_shell_rg", "ses_shell_git");
    });
  });

  test("a piped rg stays native", async () => {
    const bin = await makeBin(READY_BIN);
    await withBinary(bin, async () => {
      const { callback } = await captureGuard();

      const piped = toolEvent(
        "shell",
        { command: "rg -n resolveTool src | head" },
        "ses_shell_pipe",
        "call_shell_pipe",
      );
      await Effect.runPromise(callback(piped));
      expect(piped.tool).toBe("shell");
      expect(memories.get(session("ses_shell_pipe"))?.asked.size).toBe(0);

      forget("ses_shell_pipe");
    });
  });

  test("a permission decline fails the call and records nothing", async () => {
    const bin = await makeBin(READY_BIN);
    await withBinary(bin, async () => {
      const { callback } = await captureGuard(() => Effect.die(new Error("declined")));

      const decline = toolEvent(
        "shell",
        { command: "rg -n resolveTool src" },
        "ses_shell_decline",
        "call_shell_decline",
      );
      const exit = await Effect.runPromiseExit(callback(decline));
      expect(Exit.isFailure(exit)).toBe(true);
      expect(decline.tool).toBe("shell");
      expect(memories.get(session("ses_shell_decline"))?.asked.size).toBe(0);
      expect(rerouted.has(Tool.CallID.make("call_shell_decline"))).toBe(false);

      forget("ses_shell_decline");
    });
  });
});

describe("the first code read refuses once", () => {
  test("the first code read fails, the second completes, and a README passes", async () => {
    const bin = await makeBin(READY_BIN);
    await withBinary(bin, async () => {
      const { callback } = await captureGuard();
      const name = "ses_read_first";

      const first = await Effect.runPromiseExit(
        callback(toolEvent("read", { path: "src/retry.ts" }, name, "call_read_first")),
      );
      expect(Exit.isFailure(first)).toBe(true);
      expect(memories.get(session(name))?.spent.has("read")).toBe(true);

      const second = toolEvent("read", { path: "src/retry.ts" }, name, "call_read_second");
      const passed = await Effect.runPromiseExit(callback(second));
      expect(Exit.isSuccess(passed)).toBe(true);
      expect(second.tool).toBe("read");
      expect(memories.get(session(name))?.reads).toBe(1);

      const doc = toolEvent("read", { path: "README.md" }, "ses_read_readme", "call_read_readme");
      const docExit = await Effect.runPromiseExit(callback(doc));
      expect(Exit.isSuccess(docExit)).toBe(true);
      expect(doc.tool).toBe("read");
      expect(memories.get(session("ses_read_readme"))?.spent.has("read")).toBe(false);

      forget(name, "ses_read_readme");
    });
  });
});

describe("a landing waits for the two measurements", () => {
  test("a code edit refuses the commit until both measurements ran", async () => {
    const bin = await makeBin(READY_BIN);
    await withBinary(bin, async () => {
      const { callback } = await captureGuard();
      const name = "ses_landing_measured";

      await Effect.runPromise(callback(toolEvent("edit", { path: "src/retry.ts" }, name, "call_landing_edit")));
      expect(memories.get(session(name))?.mutation).toBe(1);
      expect(memories.get(session(name))?.measured).toEqual({});

      const refused = await Effect.runPromiseExit(
        callback(toolEvent("shell", { command: "git commit -m land" }, name, "call_landing_commit")),
      );
      expect(Exit.isFailure(refused)).toBe(true);
      expect(memories.get(session(name))?.spent.has("land")).toBe(true);

      await Effect.runPromise(
        callback(toolEvent("shell", { command: "ripwire . --quality-delta" }, name, "call_landing_delta")),
      );
      await Effect.runPromise(
        callback(
          toolEvent("shell", { command: "ripwire . --affected=src/retry.ts" }, name, "call_landing_affected"),
        ),
      );
      expect(memories.get(session(name))?.measured).toEqual({ delta: 1, affected: 1 });

      const pushed = toolEvent("shell", { command: "git push" }, name, "call_landing_push");
      const pushExit = await Effect.runPromiseExit(callback(pushed));
      expect(Exit.isSuccess(pushExit)).toBe(true);
      expect(pushed.tool).toBe("shell");

      forget(name);
    });
  });

  test("a doc-only tree lands without a measurement", async () => {
    const bin = await makeBin(READY_BIN);
    await withBinary(bin, async () => {
      const { callback } = await captureGuard();
      const name = "ses_landing_doc";

      await Effect.runPromise(callback(toolEvent("edit", { path: "README.md" }, name, "call_doc_edit")));
      expect(memories.get(session(name))?.mutation).toBe(1);
      expect(memories.get(session(name))?.editedCode.size).toBe(0);

      const commit = toolEvent("shell", { command: "git commit -m docs" }, name, "call_doc_commit");
      const exit = await Effect.runPromiseExit(callback(commit));
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(commit.tool).toBe("shell");
      expect(memories.get(session(name))?.spent.has("land")).toBe(false);

      forget(name);
    });
  });
});

describe("a host with no ripwire is native", () => {
  test("every surface passes with no-instrument, the context says so with zero CLI cues, and nothing throws", async () => {
    const bin = `${tempDir()}/ripwire-not-installed`;
    await withBinary(bin, async () => {
      const { callback } = await captureGuard();
      const name = "ses_native_all";

      const grep = toolEvent("grep", { pattern: "resolveTool" }, name, "call_native_grep");
      const grepExit = await Effect.runPromiseExit(callback(grep));
      expect(Exit.isSuccess(grepExit)).toBe(true);
      expect(grep.tool).toBe("grep");

      const rg = toolEvent("shell", { command: "rg -n resolveTool src" }, name, "call_native_rg");
      const rgExit = await Effect.runPromiseExit(callback(rg));
      expect(Exit.isSuccess(rgExit)).toBe(true);
      expect(rg.tool).toBe("shell");

      const read = toolEvent("read", { path: "src/retry.ts" }, name, "call_native_read");
      const readExit = await Effect.runPromiseExit(callback(read));
      expect(Exit.isSuccess(readExit)).toBe(true);
      expect(read.tool).toBe("read");

      await Effect.runPromise(callback(toolEvent("edit", { path: "src/retry.ts" }, name, "call_native_edit")));
      const push = toolEvent("shell", { command: "git push" }, name, "call_native_push");
      const pushExit = await Effect.runPromiseExit(callback(push));
      expect(Exit.isSuccess(pushExit)).toBe(true);
      expect(push.tool).toBe("shell");

      expect(memories.get(session(name))?.mutation).toBe(0);
      expect(memories.get(session(name))?.spent.size).toBe(0);

      const context = await captureContext();
      const draft = contextEvent(name);
      const contextExit = await Effect.runPromiseExit(context(draft));
      expect(Exit.isSuccess(contextExit)).toBe(true);
      const text = draft.system.at(-1)?.text ?? "";
      expect(text).toBe(contextRule({ kind: "absent", why: "the fixture path holds no binary" }));
      expect(text).toContain("this session is native");
      expect(text).not.toContain("--exemplar=");
      expect(text).not.toContain("tools.spectre.ripwire");
      expect(draft.tools["spectre_search"]?.description).toBe("search");

      forget(name);
    });
  });
});

describe("tools.spectre.ripwire reports skipped verbs and check clears both gates", () => {
  test("two edits and no measurement name the session, and check clears landing and report", async () => {
    const dir = tempDir();
    const bin = await makeBin(`#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "ripwire 0.6.10 (Release, built_from=test)"
  exit 0
fi
case "$*" in
  *"--quality-delta"*)
    printf '%s' '<quality-delta baseline="git-HEAD" regressions="0" gating="0" new-symbol="0" at="f00dbabe"></quality-delta>'
    exit 0
    ;;
  *"--affected="*)
    printf '%s' '<affected><test p="test/one.test.ts" hops="1"/></affected>'
    exit 0
    ;;
esac
exit 1
`);
    await withBinary(bin, async () => {
      const guard = await captureGuard();
      const after = await captureAfter();
      const name = "ses_report_delta_missing";

      for (const [idx, path] of ["src/one.ts", "src/two.ts"].entries()) {
        await Effect.runPromise(guard.callback(toolEvent("edit", { path }, name, `call_g_${idx}`)));
        await Effect.runPromise(after.callback(afterEvent("edit", { path }, name, `call_a_${idx}`)));
      }

      const initial = await Effect.runPromise(
        ripwire(readingContext(after.project, after.values, dir)).execute({ action: "report" }, toolContext(name)),
      );
      if (initial.output?.action !== "report") throw new Error("expected report output");
      expect(initial.output.sessions).toBe(1);
      expect(initial.output.findings).toEqual([
        { session: name, count: 2, missing: "ripwire . --quality-delta" },
      ]);

      const checked = await Effect.runPromise(
        ripwire(readingContext(after.project, after.values, dir)).execute({ action: "check" }, toolContext(name)),
      );
      expect(checked.output).toMatchObject({
        action: "check",
        status: "ok",
        sha: "f00dbabe",
        testsToRun: ["test/one.test.ts"],
      });

      const commit = toolEvent("shell", { command: "git commit -m land" }, name, "call_land_after_check");
      const commitExit = await Effect.runPromiseExit(guard.callback(commit));
      expect(Exit.isSuccess(commitExit)).toBe(true);

      const cleared = await Effect.runPromise(
        ripwire(readingContext(after.project, after.values, dir)).execute({ action: "report" }, toolContext(name)),
      );
      if (cleared.output?.action !== "report") throw new Error("expected report output");
      expect(cleared.output.findings).toEqual([]);

      forget(name);
    });
  });

  test("attachSearch keeps system byte-identical across edits while syncing spectre.end-of-work through check", async () => {
    const dir = tempDir();
    const bin = await makeBin(`#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "ripwire 0.6.10 (Release, built_from=test)"
  exit 0
fi
case "$*" in
  *"--quality-delta"*)
    printf '%s' '<quality-delta baseline="git-HEAD" regressions="0" gating="0" new-symbol="0" at="f00dbabe"></quality-delta>'
    exit 0
    ;;
  *"--affected="*)
    printf '%s' '<affected><test p="test/one.test.ts" hops="1"/></affected>'
    exit 0
    ;;
esac
exit 1
`);
    await withBinary(bin, async () => {
      const values = new Map<string, Schema.Json>();
      const puts: Array<{ readonly sessionID: Session.ID; readonly key: string; readonly value: unknown }> = [];
      const removes: Array<{ readonly sessionID: Session.ID; readonly key: string }> = [];
      const entries = new Map<string, unknown>();
      let onContext: ((event: unknown) => Effect.Effect<void, never>) | undefined;
      let onBefore: ((event: unknown) => Effect.Effect<void, Tool.Error>) | undefined;
      let onAfter: ((event: unknown) => Effect.Effect<void>) | undefined;

      const ctx = {
        location: locationOf(PROJECT, dir),
        storage: makeStorage(values),
        permission: { assert: () => Effect.void },
        session: {
          hook: (name: string, cb: (event: unknown) => Effect.Effect<void, never>) => {
            if (name === "context") onContext = cb;
            return Effect.succeed({ dispose: Effect.void });
          },
          instructions: {
            entry: {
              put: (input: { readonly sessionID: Session.ID; readonly key: string; readonly value: unknown }) =>
                Effect.sync(() => {
                  puts.push(input);
                  entries.set(`${input.sessionID}:${input.key}`, input.value);
                }),
              remove: (input: { readonly sessionID: Session.ID; readonly key: string }) =>
                Effect.sync(() => {
                  removes.push(input);
                  entries.delete(`${input.sessionID}:${input.key}`);
                }),
            },
          },
        },
        tool: {
          hook: (name: string, cb: (event: unknown) => Effect.Effect<void, Tool.Error>) => {
            if (name === "execute.before") onBefore = cb;
            if (name === "execute.after") onAfter = cb as (event: unknown) => Effect.Effect<void>;
            return Effect.succeed({ dispose: Effect.void });
          },
        },
      } as unknown as Plugin.Context;

      await Effect.runPromise(Effect.scoped(attachSearch(ctx)));
      if (onContext === undefined || onBefore === undefined || onAfter === undefined) {
        throw new Error("attachSearch did not register all hooks");
      }

      const name = "ses_eow_lifecycle";
      const id = session(name);

      const step1 = contextEvent(name);
      await Effect.runPromise(onContext(step1));
      const baseline = JSON.stringify(step1.system);
      expect(entries.has(`${id}:spectre.end-of-work`)).toBe(false);

      for (const [idx, path] of ["src/one.ts", "src/two.ts"].entries()) {
        await Effect.runPromise(onBefore(toolEvent("edit", { path }, name, `call_eow_b_${idx}`)));
        await Effect.runPromise(onAfter(afterEvent("edit", { path }, name, `call_eow_a_${idx}`)));
      }
      expect(puts).toEqual([{ sessionID: id, key: "spectre.end-of-work", value: END_OF_WORK }]);
      expect(entries.get(`${id}:spectre.end-of-work`)).toBe(END_OF_WORK);

      const step2 = contextEvent(name);
      await Effect.runPromise(onContext(step2));
      expect(JSON.stringify(step2.system)).toBe(baseline);
      expect(puts).toHaveLength(1);

      const checked = await Effect.runPromise(ripwire(ctx).execute({ action: "check" }, toolContext(name)));
      await Effect.runPromise(
        onAfter(afterEvent("spectre_ripwire", { action: "check" }, name, "call_eow_check", checked.output)),
      );
      expect(removes).toEqual([{ sessionID: id, key: "spectre.end-of-work" }]);
      expect(entries.has(`${id}:spectre.end-of-work`)).toBe(false);

      const step3 = contextEvent(name);
      await Effect.runPromise(onContext(step3));
      expect(JSON.stringify(step3.system)).toBe(baseline);
      expect(removes).toHaveLength(1);

      endOfWorkSynced.delete(id);
      forget(name);
    });
  });
});
