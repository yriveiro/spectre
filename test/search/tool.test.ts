import { describe, expect, test } from "bun:test";
import type { Plugin } from "@opencode/plugin/effect";
import type { Tool } from "@opencode/schema/tool";
import { Effect } from "effect";
import { CONTRACT } from "../../tools/definitions/search/contract";
import { search } from "../../tools/definitions/search";

const plugin = (directory: string): Plugin.Context =>
  ({ location: { directory } } as unknown as Plugin.Context);

const calling = (id: string): Tool.Context =>
  ({
    sessionID: "ses_search_tool_test",
    agent: "build",
    messageID: "msg_search_tool_test",
    id,
    progress: () => Effect.void,
  }) as unknown as Tool.Context;

const makeBin = async (body: string): Promise<{ dir: string; bin: string }> => {
  const dir = Bun.spawnSync(["mktemp", "-d"]).stdout.toString().trim();
  const bin = `${dir}/ripwire`;
  await Bun.write(bin, body);
  const proc = Bun.spawn(["chmod", "+x", bin]);
  await proc.exited;
  return { dir, bin };
};

const withBinary = async (bin: string, fn: () => Promise<void>): Promise<void> => {
  const prev = process.env.SPECTRE_RIPWIRE;
  try {
    process.env.SPECTRE_RIPWIRE = bin;
    await fn();
  } finally {
    if (prev === undefined) delete process.env.SPECTRE_RIPWIRE;
    else process.env.SPECTRE_RIPWIRE = prev;
  }
};

describe("search tool declaration", () => {
  test("it is the namespaced direct tool with the contract search description", () => {
    const tool = search(plugin("/tmp/search-tool-test"));
    expect(tool.name).toBe("search");
    expect(tool.options?.namespace).toBe("spectre");
    expect(tool.options?.codemode).toBe(false);
    // CONTRACT.search (wave 1 exact text) never names `spectre_search`
    // literally — it names the rule's other half, `ripgrep`. Identity with
    // the contract is the wiring proof; see the report.
    expect(tool.description).toBe(CONTRACT.search);
    expect(tool.description).toContain("ripgrep");
  });
});

describe("search execute scoping", () => {
  test("a call with no path runs on the project root instead of refusing", async () => {
    const { dir, bin } = await makeBin(`#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "ripwire 0.6.10 (Release, AppleClang 21.0.0.21000101, emit=std::print, built_from=test)"
  exit 0
fi
printf '%s' '<grep pattern="hello" hits="1"><f p="a.ts"><hit l="1" in="hello">function hello() { return 1; }</hit></f></grep>'
exit 0
`);
    await withBinary(bin, async () => {
      const tool = search(plugin(dir));
      const result = await Effect.runPromise(tool.execute({ pattern: "hello" }, calling("call_no_path")));
      expect(result.output?.status).toBe("answered");
      expect(result.output?.command).toContain(dir);
      expect(result.output?.reason).toBe("pattern");
      expect(result.content).toBe(result.output?.answer);
    });
  });

  test("a path outside the root is refused without a spawn", async () => {
    const { dir, bin } = await makeBin(`#!/bin/sh
echo "must not run" >&2
exit 1
`);
    await withBinary(bin, async () => {
      const tool = search(plugin(dir));
      const result = await Effect.runPromise(
        tool.execute({ pattern: "hello", path: "../outside" }, calling("call_escape")),
      );
      expect(result.output?.status).toBe("refused");
      expect(result.output?.reason).toBe("outside-root");
      expect(result.output?.command).toBe("");
    });
  });

  test("a path inside the root scopes the command to it", async () => {
    const { dir, bin } = await makeBin(`#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "ripwire 0.6.10 (Release, AppleClang 21.0.0.21000101, emit=std::print, built_from=test)"
  exit 0
fi
printf '%s' "$1"
exit 0
`);
    await withBinary(bin, async () => {
      const tool = search(plugin(dir));
      const result = await Effect.runPromise(
        tool.execute({ pattern: "hello", path: "src" }, calling("call_scoped")),
      );
      expect(result.output?.status).toBe("answered");
      expect(result.output?.command).toContain(`${dir}/src`);
      expect(result.output?.answer).toContain(`${dir}/src`);
    });
  });
});
