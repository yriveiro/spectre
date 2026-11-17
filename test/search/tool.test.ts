import { afterEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { search } from "../../tools/definitions/search";
import { CONTRACT } from "../../tools/definitions/search/contract";
import { cleanupDirs, makeBin, PROJECT, readingContext, tempDir, toolContext, withBinary } from "./host";

afterEach(cleanupDirs);

const contextAt = (directory: string) => readingContext(PROJECT, undefined, directory);
const calling = (id: string) => toolContext("ses_search_tool_test", id);

describe("search tool declaration", () => {
  test("it is the namespaced direct tool with the contract search description", () => {
    const tool = search(contextAt("/tmp/search-tool-test"));
    expect(tool.name).toBe("search");
    expect(tool.options?.namespace).toBe("spectre");
    expect(tool.options?.codemode).toBe(false);
    expect(tool.description).toBe(CONTRACT.search);
    expect(tool.description).toContain("ripgrep");
  });
});

describe("search execute scoping", () => {
  test("a call with no path runs on the project root instead of refusing", async () => {
    const dir = tempDir();
    const bin = await makeBin(`#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "ripwire 0.6.10 (Release, AppleClang 21.0.0.21000101, emit=std::print, built_from=test)"
  exit 0
fi
printf '%s' '<grep pattern="hello" hits="1"><f p="a.ts"><hit l="1" in="hello">function hello() { return 1; }</hit></f></grep>'
exit 0
`);
    await withBinary(bin, async () => {
      const tool = search(contextAt(dir));
      const result = await Effect.runPromise(tool.execute({ pattern: "hello" }, calling("call_no_path")));
      expect(result.output?.status).toBe("answered");
      expect(result.output?.command).toContain(dir);
      expect(result.output?.reason).toBe("pattern");
      expect(result.content).toBe(result.output?.answer);
    });
  });

  test("a path outside the root is refused without a spawn", async () => {
    const dir = tempDir();
    const bin = await makeBin(`#!/bin/sh
echo "must not run" >&2
exit 1
`);
    await withBinary(bin, async () => {
      const tool = search(contextAt(dir));
      const result = await Effect.runPromise(
        tool.execute({ pattern: "hello", path: "../outside" }, calling("call_escape")),
      );
      expect(result.output?.status).toBe("refused");
      expect(result.output?.reason).toBe("outside-root");
      expect(result.output?.command).toBe("");
    });
  });

  test("a path inside the root scopes the command to it", async () => {
    const dir = tempDir();
    const bin = await makeBin(`#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "ripwire 0.6.10 (Release, AppleClang 21.0.0.21000101, emit=std::print, built_from=test)"
  exit 0
fi
printf '%s' "$1"
exit 0
`);
    await withBinary(bin, async () => {
      const tool = search(contextAt(dir));
      const result = await Effect.runPromise(
        tool.execute({ pattern: "hello", path: "src" }, calling("call_scoped")),
      );
      expect(result.output?.status).toBe("answered");
      expect(result.output?.command).toContain(`${dir}/src`);
      expect(result.output?.answer).toContain(`${dir}/src`);
    });
  });

  test("an absent binary answers with the install line the native note promises", async () => {
    const dir = tempDir();
    const missing = `${dir}/missing-ripwire`;
    await withBinary(missing, async () => {
      const tool = search(contextAt(dir));
      const result = await Effect.runPromise(tool.execute({ pattern: "hello" }, calling("call_absent")));
      expect(result.output?.status).toBe("absent");
      expect(result.output?.note).toContain("Install it:");
      expect(result.output?.note).toContain("https://raw.githubusercontent.com/redhat-et/ripwire");
    });
  });
});

describe("search expand and thin-coverage auto-widening", () => {
  test("expand fetches a symbol body via --expand and --legend=compact", async () => {
    const dir = tempDir();
    const bin = await makeBin(`#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "ripwire 0.6.10 (Release, built_from=test)"
  exit 0
fi
printf '%s' "args:$*|<expand sym=\"src/a.ts:hello\">function hello() { return 42; }</expand>"
exit 0
`);
    await withBinary(bin, async () => {
      const tool = search(contextAt(dir));
      const result = await Effect.runPromise(
        tool.execute({ expand: "src/a.ts:hello" }, calling("call_expand")),
      );
      expect(result.output?.status).toBe("answered");
      expect(result.output?.verb).toBe("expand");
      expect(result.output?.reason).toBe("expand");
      expect(result.output?.command).toContain("--expand=src/a.ts:hello");
      expect(result.output?.command).toContain("--legend=compact");
      expect(result.output?.answer).toContain("function hello() { return 42; }");
    });
  });

  test("a thin --for answer with coverage below 50 widens automatically with --limit=40, while coverage at 50 stays single-shot", async () => {
    const dir = tempDir();
    const bin = await makeBin(`#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "ripwire 0.6.10 (Release, built_from=test)"
  exit 0
fi
case "$*" in
  *"--limit=40"*)
    printf '%s' '<ctx schema="ripwire.for/v1" task="thin" widened="1"><d n="extra" p="b.ts"/></ctx>'
    ;;
  *"--for=thin"*)
    printf '%s' '<ctx schema="ripwire.for/v1" task="thin" coverage="32"><d n="head" p="a.ts"/></ctx>'
    ;;
  *"--for=ample"*)
    printf '%s' '<ctx schema="ripwire.for/v1" task="ample" coverage="50"><d n="head" p="a.ts"/></ctx>'
    ;;
esac
exit 0
`);
    await withBinary(bin, async () => {
      const tool = search(contextAt(dir));
      const thin = await Effect.runPromise(tool.execute({ query: "thin" }, calling("call_thin")));
      expect(thin.output?.status).toBe("answered");
      expect(thin.output?.verb).toBe("for");
      expect(thin.output?.command).toContain("--signatures-only");
      expect(thin.output?.command).toContain("--limit=40");
      expect(thin.output?.command).toContain("--legend=compact");
      expect(thin.output?.answer).toContain('coverage="32"');
      expect(thin.output?.answer).toContain('widened="1"');
      expect(thin.output?.note).toContain("32%");

      const ample = await Effect.runPromise(tool.execute({ query: "ample" }, calling("call_ample")));
      expect(ample.output?.status).toBe("answered");
      expect(ample.output?.command).not.toContain("--limit=40");
      expect(ample.output?.answer).toContain('coverage="50"');
      expect(ample.output?.answer).not.toContain('widened="1"');
      expect(ample.output?.note).toBeUndefined();
    });
  });

  test("a session moved into a worktree searches session.location.directory instead of ctx.location.directory", async () => {
    const worktreeDir = tempDir();
    const bin = await makeBin(`#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "ripwire 0.6.10 (Release, built_from=test)"
  exit 0
fi
printf '%s' "cwd:$(pwd)|target:$1"
exit 0
`);
    await withBinary(bin, async () => {
      const resources: Array<ReadonlyArray<string>> = [];
      const movedPlugin = readingContext(PROJECT, undefined, "/main", {
        directory: worktreeDir,
        resources,
      });

      const tool = search(movedPlugin);
      const result = await Effect.runPromise(
        tool.execute({ pattern: "hello", path: "src" }, calling("call_moved_search")),
      );
      expect(result.output?.status).toBe("answered");
      expect(result.output?.command).toContain(`${worktreeDir}/src`);
      expect(result.output?.command).not.toContain("/main");
      expect(result.output?.answer).toContain(`target:${worktreeDir}/src`);
      expect(resources).toEqual([[`${worktreeDir}/src`]]);
    });
  });
});
