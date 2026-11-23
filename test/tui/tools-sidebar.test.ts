import { describe, expect, test } from "bun:test";
import type { Plugin } from "@opencode/plugin/tui";
import { RGBA } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { createSignal } from "solid-js";
import { toolsSidebar } from "../../tui/tools/sidebar.tsx";
import type { Usage } from "../../tui/tools/usage.ts";

const BASE = RGBA.fromInts(220, 224, 232, 255);

const theme = {
  text: { base: BASE, muted: BASE, faint: BASE },
} as unknown as Plugin.Context["theme"];

const usage: Usage = {
  tools: [
    {
      name: "spectre_read",
      calls: 3,
      shared: 0,
      tokens: { input: 100, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
    },
  ],
  totals: { calls: 3, input: 100, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
  prose: 0,
};

/** Where a glyph sits in the rendered frame, in the coordinates the mock mouse speaks. */
const at = (frame: string, needle: string): { readonly x: number; readonly y: number } => {
  const lines = frame.split("\n");
  const y = lines.findIndex((line) => line.includes(needle));
  if (y === -1) throw new Error(`frame does not contain ${needle}`);
  const x = lines[y]?.indexOf(needle) ?? -1;
  if (x === -1) throw new Error(`frame does not contain ${needle}`);
  return { x, y };
};

describe("tools sidebar", () => {
  test("clicking the collapse marker toggles the box and does not open the panel", async () => {
    const [open, setOpen] = createSignal(true);
    let toggled = 0;
    let opened = 0;
    const setup = await testRender(
      () =>
        toolsSidebar({
          theme,
          usage: () => usage,
          open,
          onToggle: () => {
            toggled += 1;
            setOpen((held) => !held);
          },
          onOpenPanel: () => {
            opened += 1;
          },
        }),
      { width: 60, height: 12 },
    );
    await setup.renderOnce();

    const marker = at(setup.captureCharFrame(), "▼");
    await setup.mockMouse.click(marker.x, marker.y);

    expect(toggled).toBe(1);
    expect(opened).toBe(0);

    await setup.dispose();
  });

  test("clicking the title opens the panel and does not toggle the box", async () => {
    const [open] = createSignal(true);
    let toggled = 0;
    let opened = 0;
    const setup = await testRender(
      () =>
        toolsSidebar({
          theme,
          usage: () => usage,
          open,
          onToggle: () => {
            toggled += 1;
          },
          onOpenPanel: () => {
            opened += 1;
          },
        }),
      { width: 60, height: 12 },
    );
    await setup.renderOnce();

    const title = at(setup.captureCharFrame(), "Tools");
    await setup.mockMouse.click(title.x, title.y);

    expect(opened).toBe(1);
    expect(toggled).toBe(0);

    await setup.dispose();
  });
});
