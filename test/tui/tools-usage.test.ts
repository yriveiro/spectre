import { describe, expect, test } from "bun:test";
import type { SessionMessageInfo, ToolContent } from "@opencode/client";
import {
  activeMessages,
  displayName,
  formatTokens,
  maxTokens,
  toolUsage,
  totalTokens,
} from "../../tui/tools/usage.ts";

const toolPart = (name: string) => ({
  type: "tool" as const,
  id: `call_${name}`,
  name,
  state: {
    status: "completed" as const,
    input: {},
    content: [{ type: "text", text: "ok" }] as [ToolContent, ...ToolContent[]],
  },
  time: { created: 1 },
});

const tokens = (input: number, output = 0, reasoning = 0, read = 0, write = 0) => ({
  input,
  output,
  reasoning,
  cache: { read, write },
});

let seq = 0;

const assistant = (
  parts: ReadonlyArray<ReturnType<typeof toolPart>>,
  usage?: ReturnType<typeof tokens>,
): SessionMessageInfo => ({
  id: `msg_${seq++}`,
  time: { created: seq },
  type: "assistant",
  agent: "build",
  model: { providerID: "opencode-go", id: "glm-5.3" },
  content: [...parts],
  ...(usage === undefined ? {} : { tokens: usage }),
});

describe("tool usage accounting", () => {
  test("a solo call is charged the whole message", () => {
    const report = toolUsage([assistant([toolPart("read")], tokens(100, 40, 10, 5, 5))]);
    expect(report.tools).toEqual([
      {
        name: "read",
        calls: 1,
        shared: 0,
        tokens: { input: 100, output: 40, reasoning: 10, cacheRead: 5, cacheWrite: 5 },
      },
    ]);
    expect(report.totals.calls).toBe(1);
    expect(totalTokens(report.totals)).toBe(160);
    expect(report.prose).toBe(0);
  });

  test("a message with several calls pro-rates its tokens across them", () => {
    const report = toolUsage([
      assistant([toolPart("read"), toolPart("read"), toolPart("edit")], tokens(300, 30, 0, 0, 0)),
    ]);
    expect(report.tools).toEqual([
      {
        name: "read",
        calls: 2,
        shared: 2,
        tokens: { input: 200, output: 20, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
      },
      {
        name: "edit",
        calls: 1,
        shared: 1,
        tokens: { input: 100, output: 10, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
      },
    ]);
    // The pro-rated rows still sum to the session's real usage.
    expect(totalTokens(report.totals)).toBe(330);
  });

  test("tokens in a message that called nothing are prose, not a tool's", () => {
    const report = toolUsage([
      assistant([toolPart("read")], tokens(100)),
      assistant([], tokens(50, 25)),
    ]);
    expect(report.tools.length).toBe(1);
    expect(totalTokens(report.totals)).toBe(100);
    expect(report.prose).toBe(75);
  });

  test("a message still streaming counts its calls but charges no tokens", () => {
    const report = toolUsage([assistant([toolPart("execute")])]);
    expect(report.tools[0]?.calls).toBe(1);
    expect(
      totalTokens(
        report.tools[0]?.tokens ?? {
          input: 0,
          output: 0,
          reasoning: 0,
          cacheRead: 0,
          cacheWrite: 0,
        },
      ),
    ).toBe(0);
  });

  test("rows sort by calls, then by name", () => {
    const report = toolUsage([
      assistant([toolPart("edit")]),
      assistant([toolPart("read"), toolPart("read")]),
      assistant([toolPart("browse_snapshot")]),
    ]);
    expect(report.tools.map((one) => one.name)).toEqual(["read", "browse_snapshot", "edit"]);
  });

  test("a revert boundary cuts the messages from it on", () => {
    const first = assistant([toolPart("read")], tokens(100));
    const boundary = assistant([toolPart("read")], tokens(100));
    const after = assistant([toolPart("edit")], tokens(100));
    expect(activeMessages([first, boundary, after], boundary.id)).toEqual([first]);
    const report = toolUsage([first, boundary, after], boundary.id);
    expect(report.totals.calls).toBe(1);
    expect(report.tools[0]?.name).toBe("read");
  });

  test("a boundary the list cannot name cuts nothing", () => {
    const first = assistant([toolPart("read")], tokens(100));
    const second = assistant([toolPart("edit")], tokens(100));
    expect(activeMessages([first, second], "msg_absent").length).toBe(2);
    expect(toolUsage([first, second], "msg_absent").totals.calls).toBe(2);
  });
});

describe("usage presentation", () => {
  test("the compact format keeps one fraction", () => {
    expect(formatTokens(8_123)).toBe("8.1K");
    expect(formatTokens(91_000)).toBe("91K");
    expect(formatTokens(1_234_000)).toBe("1.2M");
    expect(formatTokens(610)).toBe("610");
  });

  test("the display name cuts this plugin's own namespace only", () => {
    expect(displayName("spectre_brain_assert")).toBe("brain_assert");
    expect(displayName("read")).toBe("read");
    expect(displayName("other_read")).toBe("other_read");
  });

  test("the bar peak is the busiest tool, and zero tools peak at zero", () => {
    expect(maxTokens(toolUsage([assistant([toolPart("read")], tokens(500))]).tools)).toBe(500);
    expect(maxTokens(toolUsage([]).tools)).toBe(0);
  });
});
