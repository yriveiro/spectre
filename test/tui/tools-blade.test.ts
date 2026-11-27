import { describe, expect, test } from "bun:test";
import type { SessionMessageInfo, ToolContent } from "@opencode/client";
import type { Plugin } from "@opencode/plugin/tui";
import { RGBA } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { toolsBlade } from "../../tui/tools/blade.tsx";

const BASE = RGBA.fromInts(220, 224, 232, 255);
const MUTED = RGBA.fromInts(150, 156, 168, 255);
const FAINT = RGBA.fromInts(100, 108, 120, 255);

const theme = {
  text: { base: BASE, muted: MUTED, faint: FAINT },
  border: { base: FAINT },
} as unknown as Plugin.Context["theme"];

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

let seq = 0;
const assistant = (
  parts: ReadonlyArray<ReturnType<typeof toolPart>>,
  tokens?: {
    input: number;
    output: number;
    reasoning: number;
    cache: { read: number; write: number };
  },
): SessionMessageInfo => ({
  id: `msg_${seq++}`,
  time: { created: seq },
  type: "assistant",
  agent: "build",
  model: { providerID: "opencode-go", id: "glm-5.3" },
  content: [...parts],
  ...(tokens === undefined ? {} : { tokens }),
});

/** Three tools, one of them called twice in a shared message, so the draft
 * frame shows pro-rated shares and the share bar next to plain rows. */
const messages: ReadonlyArray<SessionMessageInfo> = [
  assistant([toolPart("spectre_brain_assert")], {
    input: 900,
    output: 60,
    reasoning: 20,
    cache: { read: 400, write: 100 },
  }),
  assistant([toolPart("spectre_read"), toolPart("spectre_read")], {
    input: 400,
    output: 30,
    reasoning: 0,
    cache: { read: 200, write: 60 },
  }),
  assistant([toolPart("spectre_edit")], {
    input: 210,
    output: 10,
    reasoning: 0,
    cache: { read: 10, write: 0 },
  }),
];

const panel = {
  name: "spectre.tools",
  sessionID: "ses_draft",
  width: 52,
  focused: true,
  close: () => undefined,
};

const context = {
  theme,
  data: {
    session: {
      get: () => ({ title: "draft session" }),
      message: { list: () => messages },
    },
  },
  keymap: {
    layer: () => () => undefined,
    shortcuts: () => ["t"],
  },
} as unknown as Plugin.Context;

const isRule = (line: string | undefined) => line !== undefined && /^─+$/.test(line.trim());
const isBlank = (line: string | undefined) => line !== undefined && line.trim().length === 0;

describe("tools blade layout", () => {
  test("title, column labels, rows and totals sit in separated bands with air between them", async () => {
    const setup = await testRender(
      () =>
        toolsBlade({
          context,
          panel,
        }),
      { width: 52, height: 20 },
    );
    await setup.renderOnce();
    const lines = setup.captureCharFrame().split("\n");

    // Title band, closed by a hairline with one blank row of air after it.
    expect(lines[0]).toContain("Tools");
    expect(lines[0]).toContain("draft session");
    expect(lines[0]).toContain("×");
    expect(isRule(lines[1])).toBe(true);
    expect(isBlank(lines[2])).toBe(true);

    // Column labels sit in their own band between two hairlines, at the
    // exact width of the cells they name.
    expect(lines[3]).toContain("tool");
    expect(lines[3]).toContain("calls");
    expect(lines[3]).toContain("tokens");
    expect(isRule(lines[4])).toBe(true);
    expect(isBlank(lines[5])).toBe(true);

    // Rows in the report's own order, with the share bar the width admits.
    expect(lines[6]).toContain("▌ read");
    expect(lines[6]).toContain("█");
    expect(lines[7]).toContain("brain_assert");
    expect(lines[8]).toContain("edit");

    // The numbers end exactly where their headers end, in every row.
    const callsEnd = (lines[3] ?? "").indexOf("calls") + "calls".length;
    const tokensEnd = (lines[3] ?? "").indexOf("tokens") + "tokens".length;
    expect(callsEnd).toBeGreaterThan(0);
    expect(tokensEnd).toBeGreaterThan("tokens".length);
    expect((lines[6] ?? "").indexOf("2") + 1).toBe(callsEnd);
    expect((lines[6] ?? "").indexOf("690") + 3).toBe(tokensEnd);
    expect((lines[7] ?? "").indexOf("1") + 1).toBe(callsEnd);
    expect((lines[7] ?? "").indexOf("1.5K") + 4).toBe(tokensEnd);
    expect((lines[8] ?? "").indexOf("1") + 1).toBe(callsEnd);
    expect((lines[8] ?? "").indexOf("230") + 3).toBe(tokensEnd);

    // Totals sit in their own band, closed off from the rows by air.
    expect(isBlank(lines[9])).toBe(true);
    expect(isRule(lines[10])).toBe(true);
    expect(lines[11]).toContain("Σ 3 tools · 4 calls");
    expect(isBlank(lines[12])).toBe(true);
    expect(lines[13]).toContain("cache(R/W)");
    expect(isBlank(lines[14])).toBe(true);
    expect(lines[15]).toContain("█ input · ▓ cacheRead");
    expect(isBlank(lines[16])).toBe(true);
    // No sort hint and no letter keys: only select, expand and close.
    expect(lines[17]).toContain("↑↓ select · ↵ expand");
    expect(lines[17]).toContain("esc close (t)");
    expect(lines[17]).not.toContain("sort");

    await setup.dispose();
  });

  test("a click still reaches the close box", async () => {
    let closed = 0;
    const setup = await testRender(
      () =>
        toolsBlade({
          context,
          panel: { ...panel, close: () => (closed += 1) },
        }),
      { width: 52, height: 20 },
    );
    await setup.renderOnce();
    const lines = setup.captureCharFrame().split("\n");

    const close = lines[0]?.indexOf("×") ?? -1;
    expect(close).toBeGreaterThanOrEqual(0);
    await setup.mockMouse.click(close, 0);
    expect(closed).toBe(1);

    await setup.dispose();
  });

  // A click-then-expand assertion cannot live in the default run: bun
  // resolves bare `solid-js` to the server build, so signal re-renders do
  // not repaint. Under `--conditions=browser` effects subscribe and a
  // probe repaints, but that condition is not this suite's, so the frames
  // here assert the initial state and the layout as pure data.
});
