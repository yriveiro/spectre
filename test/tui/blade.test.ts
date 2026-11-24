import { describe, expect, test } from "bun:test";
import type { Plugin } from "@opencode/plugin/tui";
import { RGBA } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { type BladeSpec, blade } from "../../tui/blade.tsx";

const BASE = RGBA.fromInts(220, 224, 232, 255);
const MUTED = RGBA.fromInts(150, 156, 168, 255);
const FAINT = RGBA.fromInts(100, 108, 120, 255);

const theme = {
  text: { base: BASE, muted: MUTED, faint: FAINT },
  border: { base: FAINT },
} as unknown as Plugin.Context["theme"];

const context = {
  theme,
  keymap: {
    layer: () => () => undefined,
    shortcuts: () => ["t"],
  },
} as unknown as Plugin.Context;

const panel = {
  name: "spectre.fake",
  sessionID: "ses_draft",
  width: 60,
  focused: true,
  close: () => undefined,
};

type Row = {
  readonly name: string;
  readonly n: number;
  readonly items: ReadonlyArray<{ readonly label: string; readonly at: number }>;
};

const rows: ReadonlyArray<Row> = [
  { name: "build", n: 3, items: [{ label: "one", at: 1 }] },
  { name: "explore", n: 1, items: [{ label: "two", at: 2 }] },
];

type Item = { readonly label: string; readonly at: number };

const descriptor = (): BladeSpec<Row, Item> => ({
  context,
  panel,
  id: "spectre.fake",
  title: "Fake blade",
  subtitle: () => "draft session",
  empty: () => "Nothing yet.",
  sections: () => [
    { header: "agent", rows: rows.slice(0, 1) },
    { header: "profile", rows: rows.slice(1) },
  ],
  columns: [
    { header: "row", cell: (row: Row) => row.name },
    { header: "n", width: 6, align: "right", cell: (row: Row) => String(row.n) },
  ],
  summary: () => [{ text: "Σ 2 rows" }, { text: "in 3 · out 1", tone: "faint" as const }],
  detail: {
    table: {
      rows: (row: Row) => row.items,
      bandTitle: (row: Row) => `▼ ${row.name} · ${row.items.length} item`,
      marker: (one: { readonly label: string; readonly at: number }) => ({
        text: one.at === 1 ? "✓" : "·",
      }),
      columns: [
        { header: "item", cell: (one: { readonly label: string; readonly at: number }) => one.label },
        {
          header: "at",
          width: 6,
          align: "right" as const,
          cell: (one: { readonly label: string; readonly at: number }) => String(one.at),
        },
      ],
    },
    bands: (
      row: Row,
      picked: { readonly label: string; readonly at: number } | undefined,
    ) => [
      { label: "row", value: row.name },
      { label: "picked", value: picked?.label ?? "none" },
    ],
    cap: 4,
  },
});

const isRule = (line: string | undefined) => line !== undefined && /^─+$/.test(line.trim());

describe("blade engine", () => {
  test("the canonical skeleton: heads, rows, summary, detail table, bands and hints", async () => {
    const setup = await testRender(() => blade(descriptor()), { width: 60, height: 30 });
    await setup.renderOnce();
    const lines = setup.captureCharFrame().split("\n");

    expect(lines[0]).toContain("Fake blade");
    expect(lines[0]).toContain("draft session");
    expect(lines[0]).toContain("×");
    expect(isRule(lines[1])).toBe(true);

    // Section heads sit over their own rules, sections separated by air.
    const agentHead = lines.findIndex((one) => one.includes("agent"));
    expect(agentHead).toBeGreaterThanOrEqual(0);
    expect(isRule(lines[agentHead + 1])).toBe(true);
    expect(lines[agentHead + 3] ?? "").toContain("▌ build");
    expect((lines[agentHead + 3] ?? "").trimEnd().endsWith("3")).toBe(true);
    const profileHead = lines.findIndex((one) => one.includes("profile"));
    expect(profileHead).toBeGreaterThan(agentHead);
    expect(lines[profileHead + 3] ?? "").toContain("explore");

    // The summary under its own rule.
    const summary = lines.findIndex((one) => one.includes("Σ 2 rows"));
    expect(summary).toBeGreaterThan(profileHead);
    expect(lines[summary + 1]).toContain("in 3 · out 1");

    // The detail: band title, nested head, the picked row, then the bands
    // reading the row the nested selection points at.
    const bandTitle = lines.findIndex((one) => one.includes("▼ build"));
    expect(bandTitle).toBeGreaterThan(summary);
    expect(lines[bandTitle + 1] ?? "").toContain("item");
    expect(lines[bandTitle + 2] ?? "").toContain("✓ one");
    const picked = lines.findIndex((one) => one.includes("picked"));
    expect(picked).toBeGreaterThan(bandTitle);
    // The bands read the row and the nested selection, aligned at the label column.
    expect(lines[picked - 1] ?? "").toContain("row");
    expect(lines[picked - 1] ?? "").toContain("build");
    expect(lines[picked] ?? "").toContain("one");

    // The hints row: no sort, no letters.
    expect(lines.some((one) => one.includes("sort n"))).toBe(false);
    expect(lines.some((one) => one.includes("↑↓ select"))).toBe(true);
    expect(lines.some((one) => one.includes("· esc close (t)"))).toBe(true);

    await setup.dispose();
  });

  test("an empty report hides the table, summary, detail and hints", async () => {
    const empty: BladeSpec<Row, Item> = {
      ...descriptor(),
      sections: () => [{ header: "agent", rows: [] }],
    };
    const setup = await testRender(() => blade(empty), { width: 60, height: 12 });
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Nothing yet.");
    expect(frame).not.toContain("Σ");
    expect(frame).not.toContain("↑↓ select");
    await setup.dispose();
  });
});
