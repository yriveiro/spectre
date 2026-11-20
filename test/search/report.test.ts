import { afterEach, describe, expect, test } from "bun:test";
import { Session } from "@opencode/schema/session";
import type { Schema } from "effect";
import { Effect } from "effect";
import { ripwire } from "../../tools/definitions/search";
import { decide, shellParse } from "../../tools/definitions/search/policy";
import { memories, memoryOf } from "../../tools/definitions/search/state";
import {
  afterEvent,
  captureAfter,
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

const DELTA = "ripwire . --quality-delta";
const LOOKUP = "ripwire . --for=<task>";
const FANOUT = "ripwire . --pack-task=<task> --partition=<n>";

const callReport = (values: Map<string, Schema.Json>, project: string = PROJECT) =>
  Effect.runPromise(
    ripwire(readingContext(project, values)).execute(
      { action: "report" },
      toolContext("ses_report_reader"),
    ),
  );

const readReport = async (values: Map<string, Schema.Json>, project: string = PROJECT) => {
  const result = await callReport(values, project);
  if (result.output === undefined || result.output.action !== "report") {
    throw new Error("the report returned no report output");
  }
  return { content: result.content, output: result.output };
};

const edit = (after: Awaited<ReturnType<typeof captureAfter>>, session: string, index: number) =>
  Effect.runPromise(
    after.callback(
      afterEvent("edit", { path: `src/file_${index}.ts` }, session, `call_report_edit_${index}`),
    ),
  );

afterEach(cleanupDirs);

describe("tools.spectre.ripwire declaration and report arm", () => {
  test("it is an unpinned code-mode tool in the spectre namespace", () => {
    const tool = ripwire(readingContext(PROJECT));
    expect(tool.name).toBe("ripwire");
    expect(tool.options).toEqual({ namespace: "spectre", codemode: true });
    expect(tool.options?.pinned).toBeUndefined();
    expect(tool.description.split("\n")[0]?.length ?? 999).toBeLessThanOrEqual(120);
  });

  test("an empty record reports no session and no finding", async () => {
    const result = await readReport(new Map());
    expect(result.output.status).toBe("reported");
    expect(result.output.sessions).toBe(0);
    expect(result.output.findings).toEqual([]);
    expect(result.output.summary).toContain("has been recorded yet");
  });

  test("a second project's sessions are invisible", async () => {
    const bin = await makeBin(READY_BIN);
    await withBinary(bin, async () => {
      const after = await captureAfter("prj_report_a");
      await edit(after, "ses_report_scoped", 0);

      const own = await readReport(after.values, "prj_report_a");
      expect(own.output.sessions).toBe(1);

      const other = await readReport(after.values, "prj_report_b");
      expect(other.output.sessions).toBe(0);
      expect(other.output.findings).toEqual([]);
      memories.delete(Session.ID.make("ses_report_scoped"));
    });
  });
});

describe("the report arm names edits, reads, and spawns that skipped verbs", () => {
  test("a session with 148 edits and no delta is named", async () => {
    const bin = await makeBin(READY_BIN);
    await withBinary(bin, async () => {
      const after = await captureAfter();
      const name = "ses_report_148";
      for (let index = 0; index < 148; index += 1) await edit(after, name, index);

      const result = await readReport(after.values);
      expect(result.output.findings).toEqual([{ session: name, count: 148, missing: DELTA }]);
      expect(result.output.summary).toContain(name);
      expect(result.output.summary).toContain("148");
      expect(result.content).toBe(result.output.summary);
      memories.delete(Session.ID.make(name));
    });
  });

  test("a delta after the last edit clears the finding", async () => {
    const bin = await makeBin(READY_BIN);
    await withBinary(bin, async () => {
      const after = await captureAfter();
      const name = "ses_report_measured";
      await edit(after, name, 0);
      await edit(after, name, 1);
      await Effect.runPromise(
        after.callback(
          afterEvent("shell", { command: "ripwire . --quality-delta" }, name, "call_report_delta", {
            output: "clean",
          }),
        ),
      );

      expect((await readReport(after.values)).output.findings).toEqual([]);
      memories.delete(Session.ID.make(name));
    });
  });

  test("a delta older than the last edit still names the session", async () => {
    const bin = await makeBin(READY_BIN);
    await withBinary(bin, async () => {
      const after = await captureAfter();
      const name = "ses_report_stale_delta";
      await edit(after, name, 0);
      await Effect.runPromise(
        after.callback(
          afterEvent("shell", { command: "ripwire . --quality-delta" }, name, "call_report_stale", {
            output: "clean",
          }),
        ),
      );
      await edit(after, name, 1);

      expect((await readReport(after.values)).output.findings).toEqual([
        { session: name, count: 2, missing: DELTA },
      ]);
      memories.delete(Session.ID.make(name));
    });
  });

  test("a session with code reads and no lookup is named, and a search clears it", async () => {
    const bin = await makeBin(READY_BIN);
    await withBinary(bin, async () => {
      const after = await captureAfter();
      const name = "ses_report_reads";
      await Effect.runPromise(
        after.callback(afterEvent("read", { path: "/tmp/src/a.ts" }, name, "call_report_r1")),
      );
      await Effect.runPromise(
        after.callback(afterEvent("read", { path: "/tmp/src/b.ts" }, name, "call_report_r2")),
      );

      expect((await readReport(after.values)).output.findings).toEqual([
        { session: name, count: 2, missing: LOOKUP },
      ]);

      await Effect.runPromise(
        after.callback(
          afterEvent("spectre_search", { query: "retry" }, name, "call_report_search", {
            status: "answered",
          }),
        ),
      );

      expect((await readReport(after.values)).output.findings).toEqual([]);
      memories.delete(Session.ID.make(name));
    });
  });

  test("a session with two spawns and no fan-out is named, while a single spawn or nocturna/sicko is not, and pack-task clears it", async () => {
    const bin = await makeBin(READY_BIN);
    await withBinary(bin, async () => {
      const after = await captureAfter();
      const name = "ses_report_fanout";
      for (const [idx, agent] of ["nocturna", "sicko"].entries()) {
        await Effect.runPromise(
          after.callback(
            afterEvent("subagent", { agent, prompt: "audit" }, name, `call_report_exempt_${idx}`, {
              sessionID: `ses_report_exempt_${idx}`,
              status: "completed",
              output: "done",
            }),
          ),
        );
      }
      expect((await readReport(after.values)).output.sessions).toBe(0);

      await Effect.runPromise(
        after.callback(
          afterEvent("subagent", { agent: "explore", prompt: "x" }, name, "call_report_spawn_1", {
            sessionID: "ses_report_child_1",
            status: "completed",
            output: "done",
          }),
        ),
      );
      expect((await readReport(after.values)).output.findings).toEqual([]);

      await Effect.runPromise(
        after.callback(
          afterEvent("subagent", { agent: "explore", prompt: "y" }, name, "call_report_spawn_2", {
            sessionID: "ses_report_child_2",
            status: "completed",
            output: "done",
          }),
        ),
      );
      expect((await readReport(after.values)).output.findings).toEqual([
        { session: name, count: 2, missing: FANOUT },
      ]);

      await Effect.runPromise(
        after.callback(
          afterEvent(
            "shell",
            { command: 'ripwire . --pack-task="map" --partition=2' },
            name,
            "call_report_pack",
            {
              output: "core",
            },
          ),
        ),
      );

      expect((await readReport(after.values)).output.findings).toEqual([]);
      memories.delete(Session.ID.make(name));
    });
  });

  test("a child's own edits name its parent", async () => {
    const bin = await makeBin(READY_BIN);
    await withBinary(bin, async () => {
      const after = await captureAfter();
      const parent = "ses_report_parent";
      const child = "ses_report_child_edits";
      await Effect.runPromise(
        after.callback(
          afterEvent("subagent", { agent: "spectre", prompt: "x" }, parent, "call_report_birth", {
            sessionID: child,
            status: "completed",
            output: "done",
          }),
        ),
      );
      await edit(after, child, 0);

      const findings = (await readReport(after.values)).output.findings;
      expect(findings).toContainEqual({ session: child, parent, count: 1, missing: DELTA });
      memories.delete(Session.ID.make(parent));
      memories.delete(Session.ID.make(child));
    });
  });

  test("a stock child writes no row of its own", async () => {
    const bin = await makeBin(READY_BIN);
    await withBinary(bin, async () => {
      const after = await captureAfter();
      const parent = "ses_report_stock_parent";
      const child = "ses_report_stock_child";
      await Effect.runPromise(
        after.callback(
          afterEvent(
            "subagent",
            { agent: "explore", prompt: "x" },
            parent,
            "call_report_stock_birth",
            {
              sessionID: child,
              status: "completed",
              output: "done",
            },
          ),
        ),
      );
      await Effect.runPromise(
        after.callback(
          afterEvent(
            "subagent",
            { agent: "explore", prompt: "y" },
            parent,
            "call_report_stock_birth_2",
            {
              sessionID: "ses_report_stock_child_2",
              status: "completed",
              output: "done",
            },
          ),
        ),
      );
      await Effect.runPromise(
        after.callback(
          afterEvent(
            "edit",
            { path: "src/stock.ts" },
            child,
            "call_report_stock_edit",
            undefined,
            "explore",
          ),
        ),
      );

      const out = (await readReport(after.values)).output;
      expect(out.sessions).toBe(1);
      expect(out.findings).toEqual([{ session: parent, count: 2, missing: FANOUT }]);
      memories.delete(Session.ID.make(parent));
      memories.delete(Session.ID.make(child));
    });
  });
});

describe("the check arm runs quality-delta and affected, parses XML, and clears both gates", () => {
  test("absent when ripwire is missing, nothing-edited when no code changed, and refused when paths escape root", async () => {
    const dir = tempDir();
    await withBinary(`${dir}/missing-ripwire`, async () => {
      const absentRes = await Effect.runPromise(
        ripwire(readingContext(PROJECT, new Map(), dir)).execute(
          {},
          toolContext("ses_check_absent"),
        ),
      );
      expect(absentRes.output).toMatchObject({ action: "check", status: "absent" });
      expect(absentRes.output?.summary).toContain("Install it:");
    });

    const bin = await makeBin(READY_BIN);
    await withBinary(bin, async () => {
      const noneRes = await Effect.runPromise(
        ripwire(readingContext(PROJECT, new Map(), dir)).execute(
          { action: "check", paths: ["README.md"] },
          toolContext("ses_check_none"),
        ),
      );
      expect(noneRes.output).toMatchObject({
        action: "check",
        status: "nothing-edited",
        summary: "No code files were edited in this session.",
      });

      const escapedRes = await Effect.runPromise(
        ripwire(readingContext(PROJECT, new Map(), dir)).execute(
          { action: "check", paths: ["../outside.ts"] },
          toolContext("ses_check_escape"),
        ),
      );
      expect(escapedRes.output).toMatchObject({ action: "check", status: "refused" });
      expect(escapedRes.output?.summary).toContain("outside");
    });

    memories.delete(Session.ID.make("ses_check_absent"));
    memories.delete(Session.ID.make("ses_check_none"));
    memories.delete(Session.ID.make("ses_check_escape"));
  });

  test("exit 0 parses at=, new-symbol rows, and both <test> and <g> affected test paths, clearing onLanding and report", async () => {
    const dir = tempDir();
    const bin = await makeBin(`#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "ripwire 0.6.10 (Release, built_from=test)"
  exit 0
fi
case "$*" in
  *"--quality-delta"*)
    printf '%s' '<quality-delta baseline="git-HEAD" regressions="1" gating="0" new-symbol="1" at="deadbeef"><r kind="api-surface" sym="src/one.ts:helper" origin="new-symbol" now="1"/></quality-delta>'
    exit 0
    ;;
  *"--affected=src/one.ts,src/two.ts"*)
    printf '%s' '<affected><test p="test/z.test.ts" hops="1"/><g hops="2" n="2" p="test/b.test.ts,test/a.test.ts" run_unknown="1"/><t p="test/a.test.ts" run="bun test"/></affected>'
    exit 0
    ;;
esac
exit 1
`);
    await withBinary(bin, async () => {
      const guard = await captureGuard();
      const after = await captureAfter("prj_check_ok");
      const name = "ses_check_ok";

      for (const [idx, path] of ["src/two.ts", "src/one.ts"].entries()) {
        await Effect.runPromise(
          guard.callback(toolEvent("edit", { path }, name, `call_chk_b_${idx}`)),
        );
        await Effect.runPromise(
          after.callback(afterEvent("edit", { path }, name, `call_chk_a_${idx}`)),
        );
      }

      const beforeReport = await readReport(after.values, "prj_check_ok");
      expect(beforeReport.output.findings).toEqual([{ session: name, count: 2, missing: DELTA }]);

      const checkRes = await Effect.runPromise(
        ripwire(readingContext("prj_check_ok", after.values, dir)).execute({}, toolContext(name)),
      );
      expect(checkRes.output).toEqual({
        action: "check",
        status: "ok",
        sha: "deadbeef",
        gating: 0,
        regressions: 1,
        newSymbols: 1,
        newSymbolRows: [
          '<r kind="api-surface" sym="src/one.ts:helper" origin="new-symbol" now="1"/>',
        ],
        testsToRun: ["test/a.test.ts", "test/b.test.ts", "test/z.test.ts"],
        paths: ["src/one.ts", "src/two.ts"],
        commands: [
          `${bin} ${dir} --quality-delta --legend=compact`,
          `${bin} ${dir} --affected=src/one.ts,src/two.ts --legend=compact`,
        ],
        summary:
          "ripwire check (ok at=deadbeef): gating=0 regressions=1 new-symbol=1; tests to run: test/a.test.ts, test/b.test.ts, test/z.test.ts",
      });

      const landing = decide(
        {
          surface: "shell",
          command: "git commit -m land",
          parsed: shellParse("git commit -m land"),
        },
        memoryOf(Session.ID.make(name)),
        { health: { kind: "ready", binary: bin, version: "0.6.10" } },
      );
      expect(landing.verdict).toEqual({ kind: "pass", why: "measured" });

      const afterReport = await readReport(after.values, "prj_check_ok");
      expect(afterReport.output.findings).toEqual([]);

      memories.delete(Session.ID.make(name));
    });
  });

  test("exit 2 on quality-delta returns status gating rather than refused, while exit 5 refuses", async () => {
    const dir = tempDir();
    const gatingBin = await makeBin(`#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "ripwire 0.6.10 (Release, built_from=test)"
  exit 0
fi
case "$*" in
  *"--quality-delta"*)
    printf '%s' '<quality-delta baseline="git-HEAD" regressions="2" gating="2" new-symbol="0" at="cafebabe"><r kind="complexity" sym="src/one.ts:run" was="4" now="9"/></quality-delta>'
    exit 2
    ;;
  *"--affected=src/one.ts"*)
    printf '%s' '<affected><test p="test/one.test.ts" hops="1"/></affected>'
    exit 0
    ;;
esac
exit 1
`);
    await withBinary(gatingBin, async () => {
      const res = await Effect.runPromise(
        ripwire(readingContext(PROJECT, new Map(), dir)).execute(
          { action: "check", paths: ["src/one.ts"] },
          toolContext("ses_check_gating"),
        ),
      );
      expect(res.output).toMatchObject({
        action: "check",
        status: "gating",
        sha: "cafebabe",
        gating: 2,
        regressions: 2,
        newSymbols: 0,
        testsToRun: ["test/one.test.ts"],
      });
      memories.delete(Session.ID.make("ses_check_gating"));
    });

    const oomBin = await makeBin(`#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "ripwire 0.6.10 (Release, built_from=test)"
  exit 0
fi
echo "ripwire: out of memory" >&2
exit 5
`);
    await withBinary(oomBin, async () => {
      const res = await Effect.runPromise(
        ripwire(readingContext(PROJECT, new Map(), dir)).execute(
          { action: "check", paths: ["src/one.ts"] },
          toolContext("ses_check_oom"),
        ),
      );
      expect(res.output).toMatchObject({
        action: "check",
        status: "refused",
      });
      expect(res.output?.summary).toContain("out of memory");
      memories.delete(Session.ID.make("ses_check_oom"));
    });
  });

  test("explicit subset paths run instead of session memory without marking unmeasured edits as measured", async () => {
    const dir = tempDir();
    const bin = await makeBin(`#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "ripwire 0.6.10 (Release, built_from=test)"
  exit 0
fi
case "$*" in
  *"--quality-delta"*)
    printf '%s' '<quality-delta baseline="git-HEAD" regressions="0" gating="0" new-symbol="0" at="11223344"></quality-delta>'
    exit 0
    ;;
  *"--affected=src/one.ts,src/two.ts"*)
    printf '%s' '<affected><test p="test/all.test.ts" hops="1"/></affected>'
    exit 0
    ;;
  *"--affected=src/one.ts"*)
    printf '%s' '<affected><test p="test/one.test.ts" hops="1"/></affected>'
    exit 0
    ;;
esac
exit 1
`);
    await withBinary(bin, async () => {
      const guard = await captureGuard();
      const after = await captureAfter("prj_check_subset");
      const name = "ses_check_subset";

      for (const [idx, path] of ["src/one.ts", "src/two.ts"].entries()) {
        await Effect.runPromise(
          guard.callback(toolEvent("edit", { path }, name, `call_sub_b_${idx}`)),
        );
        await Effect.runPromise(
          after.callback(afterEvent("edit", { path }, name, `call_sub_a_${idx}`)),
        );
      }

      const subset = await Effect.runPromise(
        ripwire(readingContext("prj_check_subset", after.values, dir)).execute(
          { action: "check", paths: ["src/one.ts"] },
          toolContext(name),
        ),
      );
      expect(subset.output).toMatchObject({
        action: "check",
        status: "ok",
        paths: ["src/one.ts"],
        testsToRun: ["test/one.test.ts"],
      });
      expect(memoryOf(Session.ID.make(name)).touched).toBe(1);
      expect(memoryOf(Session.ID.make(name)).measured).toEqual({ delta: 2 });

      const stillUnmeasured = decide(
        {
          surface: "shell",
          command: "git commit -m land",
          parsed: shellParse("git commit -m land"),
        },
        memoryOf(Session.ID.make(name)),
        { health: { kind: "ready", binary: bin, version: "0.6.10" } },
      );
      expect(stillUnmeasured.verdict.kind).toBe("refuse");
      expect((await readReport(after.values, "prj_check_subset")).output.findings).toEqual([]);

      const full = await Effect.runPromise(
        ripwire(readingContext("prj_check_subset", after.values, dir)).execute(
          {},
          toolContext(name),
        ),
      );
      expect(full.output).toMatchObject({
        action: "check",
        status: "ok",
        paths: ["src/one.ts", "src/two.ts"],
        testsToRun: ["test/all.test.ts"],
      });
      expect(memoryOf(Session.ID.make(name)).touched).toBe(2);
      expect(memoryOf(Session.ID.make(name)).measured).toEqual({ delta: 2, affected: 2 });
      expect((await readReport(after.values, "prj_check_subset")).output.findings).toEqual([]);

      memories.delete(Session.ID.make(name));
    });
  });

  test("falls back to git status --porcelain -uall when input.paths is omitted and editedCode is empty", async () => {
    const repo = tempDir();
    const git = (args: ReadonlyArray<string>) => {
      const res = Bun.spawnSync(["git", ...args], {
        cwd: repo,
        env: {
          ...Bun.env,
          GIT_CONFIG_COUNT: "2",
          GIT_CONFIG_KEY_0: "commit.gpgsign",
          GIT_CONFIG_VALUE_0: "false",
          GIT_CONFIG_KEY_1: "tag.gpgsign",
          GIT_CONFIG_VALUE_1: "false",
        },
      });
      if (res.exitCode !== 0) throw new Error(res.stderr.toString());
    };

    git(["init"]);
    git(["config", "user.name", "Spectre"]);
    git(["config", "user.email", "spectre@local"]);
    await Bun.write(`${repo}/src/base.ts`, "export const a = 1;\n");
    await Bun.write(`${repo}/src/old.ts`, "export const b = 1;\n");
    await Bun.write(`${repo}/src/deleted.ts`, "export const c = 1;\n");
    await Bun.write(`${repo}/README.md`, "# Doc\n");
    git(["add", "."]);
    git(["commit", "-m", "init"]);

    const bin = await makeBin(`#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "ripwire 0.6.10 (Release, built_from=test)"
  exit 0
fi
case "$*" in
  *"--quality-delta"*)
    printf '%s' '<quality-delta baseline="git-HEAD" regressions="0" gating="0" new-symbol="0" at="abcd1234"></quality-delta>'
    exit 0
    ;;
  *"--affected=src/base.ts,src/new.ts,src/renamed file.ts"*)
    printf '%s' '<affected><test p="test/git.test.ts" hops="1"/></affected>'
    exit 0
    ;;
esac
exit 1
`);

    await withBinary(bin, async () => {
      await Bun.write(`${repo}/README.md`, "# Updated doc\n");
      const docOnly = await Effect.runPromise(
        ripwire(readingContext("prj_git_fallback", new Map(), repo)).execute(
          {},
          toolContext("ses_git_doc_only"),
        ),
      );
      expect(docOnly.output).toMatchObject({ action: "check", status: "nothing-edited" });

      await Bun.write(`${repo}/src/base.ts`, "export const a = 2;\n");
      git(["mv", "src/old.ts", "src/renamed file.ts"]);
      await Bun.file(`${repo}/src/deleted.ts`).delete();
      await Bun.write(`${repo}/src/new.ts`, "export const d = 4;\n");

      const checked = await Effect.runPromise(
        ripwire(readingContext("prj_git_fallback", new Map(), repo)).execute(
          {},
          toolContext("ses_git_dirty"),
        ),
      );
      expect(checked.output).toMatchObject({
        action: "check",
        status: "ok",
        sha: "abcd1234",
        paths: ["src/base.ts", "src/new.ts", "src/renamed file.ts"],
        testsToRun: ["test/git.test.ts"],
      });

      memories.delete(Session.ID.make("ses_git_doc_only"));
      memories.delete(Session.ID.make("ses_git_dirty"));
    });
  });

  test("a session moved into a worktree checks session.location.directory instead of ctx.location.directory", async () => {
    const worktreeDir = tempDir();
    const bin = await makeBin(`#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "ripwire 0.6.10 (Release, built_from=test)"
  exit 0
fi
case "$*" in
  *"--quality-delta"*)
    printf '<quality-delta baseline="git-HEAD" regressions="0" gating="0" new-symbol="0" at="%s"></quality-delta>' "$1"
    exit 0
    ;;
  *"--affected=src/moved.ts"*)
    printf '%s' '<affected><test p="test/moved.test.ts" hops="1"/></affected>'
    exit 0
    ;;
esac
exit 1
`);
    await withBinary(bin, async () => {
      const resources: Array<ReadonlyArray<string>> = [];
      const ctx = readingContext("prj_moved_check", undefined, "/main", {
        directory: worktreeDir,
        resources,
      });

      const res = await Effect.runPromise(
        ripwire(ctx).execute(
          { action: "check", paths: ["src/moved.ts"] },
          toolContext("ses_moved_check"),
        ),
      );
      expect(res.output).toMatchObject({
        action: "check",
        status: "ok",
        sha: worktreeDir,
        paths: ["src/moved.ts"],
        commands: [
          `${bin} ${worktreeDir} --quality-delta --legend=compact`,
          `${bin} ${worktreeDir} --affected=src/moved.ts --legend=compact`,
        ],
        testsToRun: ["test/moved.test.ts"],
      });
      expect(resources).toEqual([[worktreeDir]]);

      memories.delete(Session.ID.make("ses_moved_check"));
    });
  });
});
