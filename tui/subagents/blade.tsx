import type { Plugin } from "@opencode/plugin/tui";
import { TextAttributes } from "@opentui/core";
import type { JSX } from "@opentui/solid";
import { createMemo, createSignal } from "solid-js";
import { h, show } from "../render.ts";
import {
  formatCost,
  formatTokens,
  type ProfileRouting,
  type ProfileRun,
  type ProfileUsage,
  profileLabel,
  sessionUsage,
  totalTokens,
} from "./usage.ts";

/** Share-bar cells. One cell is the resolution the eye can rank with anyway. */
const BAR_CELLS = 10;

/** Fixed column widths. The header pads to the same widths, so labels sit
 * exactly where the numbers do, and every row pads the same way. The run
 * table pads to the same token and cost widths, so a run's numbers sit in
 * the columns the summary already uses; the cache column is wider because it
 * carries read/write as one figure. */
const MODEL_COLUMN = 26;
const RUNS_COLUMN = 5;
const TOKENS_COLUMN = 7;
const CACHE_COLUMN = 9;
const COST_COLUMN = 8;

/** Left-aligned fixed column: clip with an ellipsis, never widen. */
const fit = (text: string, width: number): string =>
  text.length > width ? `${text.slice(0, width - 1)}…` : text.padEnd(width);

const bar = (tokens: number, peak: number): string => {
  // A row with no tokens draws no fill: a one-cell artifact on a seeded
  // zero-usage profile reads as spend that does not exist.
  if (peak <= 0 || tokens <= 0) return " ".repeat(BAR_CELLS);
  const filled = Math.max(1, Math.round((tokens / peak) * BAR_CELLS));
  return "█".repeat(Math.min(BAR_CELLS, filled)).padEnd(BAR_CELLS);
};

const outcomeMark = (run: ProfileUsage["runs"][number]["run"]): string => {
  if (run.running) return "●";
  switch (run.outcome) {
    case "failed":
      return "✗";
    case "interrupted":
      return "⌁";
    case "succeeded":
      return "✓";
    default:
      // No idle marker and not running: an execution cut off by a shutdown.
      // Claiming success would invent an outcome the transcript never gave.
      return "·";
  }
};

/**
 * The session panel: two sections over one partition — the main agent's own
 * spend, then the routing profiles, whatever stayed unrouted, and compaction
 * — and one run table. The rows partition the session, so the tokens column
 * sums to the footer total across both sections; the table below the totals
 * shows the selected row's runs, so inspection costs nothing beyond moving
 * the selection. The keymap layer is created inside the component, so the
 * panel's keys stop existing the moment the host closes it, and `enabled`
 * keeps them from firing while the panel is up but the prompt owns the
 * keyboard.
 */
export const subagentsBlade = (input: {
  readonly context: Plugin.Context;
  readonly panel: {
    readonly name: string;
    readonly sessionID: string;
    readonly width: number;
    readonly focused: boolean;
    readonly close: () => void;
  };
  readonly profiles: () => ReadonlyArray<ProfileRouting>;
  readonly sortBy: () => "tokens" | "cost";
  readonly onSortToggle: () => void;
}): JSX.Element => {
  const context = input.context;
  const theme = context.theme;

  // One walk of the family per change, rooted at the family root: a panel
  // opened on a child still books the root's spend under the main agent and
  // the children under their profiles. Every row's share bar, the run table
  // and the footer read this memo, so a redraw never re-folds the family,
  // and a message landing mid-render cannot give two rows different totals.
  const report = createMemo(() =>
    sessionUsage({
      rootID: context.data.session.root(input.panel.sessionID),
      family: (id) => context.data.session.family(id),
      get: (id) => context.data.session.get(id),
      status: (id) => context.data.session.status(id),
      messages: (id) => context.data.session.message.list(id),
      profiles: input.profiles(),
    }),
  );

  const rowText = (row: ProfileUsage): string => (row.kind === "main" ? row.agent : profileLabel(row));

  /**
   * The panel's two sections: the main agent's own spend, then the profiles
   * (plus unrouted and compaction). Selection walks both in order, and the
   * footer sums both, so the sections are a display split of one partition.
   */
  const bands = () => {
    const by = input.sortBy();
    const main = report().rows.filter((row) => row.kind === "main");
    const rest = report().rows.filter((row) => row.kind !== "main");
    const order = (list: ProfileUsage[]) => {
      const sorted = [...list];
      sorted.sort((a, b) => {
        if (by === "cost") return b.cost - a.cost || rowText(a).localeCompare(rowText(b));
        return totalTokens(b.tokens) - totalTokens(a.tokens) || rowText(a).localeCompare(rowText(b));
      });
      return sorted;
    };
    return { main: order(main), rest: order(rest) };
  };

  const ordered = (): ReadonlyArray<ProfileUsage> => [...bands().main, ...bands().rest];

  const [selected, setSelected] = createSignal(0);

  /** The clamped selection index. A reroute can shorten the row list under a
   * selection, and the marker, the bold row and the runs table must all agree
   * on which row is selected, so every read goes through this clamp. */
  const selectionAt = (): number => {
    const count = ordered().length;
    return Math.min(selected(), Math.max(0, count - 1));
  };

  /** The row the selection points at, so the run table always names a real
   * row even after the list shrank under the selection. */
  const selectedRow = (): ProfileUsage | undefined => ordered()[selectionAt()];

  const move = (delta: number): void => {
    const count = ordered().length;
    if (count === 0) return;
    setSelected((at) => Math.min(count - 1, Math.max(0, at + delta)));
  };

  context.keymap.layer(() => ({
    enabled: () => input.panel.focused,
    commands: [
      {
        id: "spectre.subagents.close",
        title: "Close session breakdown",
        bind: "escape",
        run: () => input.panel.close(),
      },
      {
        id: "spectre.subagents.sort",
        title: "Sort rows by tokens or cost",
        bind: "t",
        run: () => input.onSortToggle(),
      },
      { bind: "up", run: () => move(-1) },
      { bind: "down", run: () => move(1) },
    ],
  }));

  const peak = (): number =>
    Math.max(0, ...report().rows.map((one) => totalTokens(one.tokens)));

  const sortHint = (): string => {
    const key = context.keymap.shortcuts("spectre.subagents.sort")[0] ?? "t";
    return input.sortBy() === "cost" ? `sort tokens (${key})` : `sort cost (${key})`;
  };

  /** A full-width hairline: the panel's own width minus its side padding.
   * It never shrinks, so a short panel loses run rows, not rules. */
  const rule = (): JSX.Element =>
    h(
      "text",
      { fg: theme.border?.base ?? theme.text.faint, wrapMode: "none", flexShrink: 0 },
      "─".repeat(Math.max(0, input.panel.width - 2)),
    );

  /** One empty row, never a shareable one. The table reads better with air
   * between its bands, and shrinking air would move the rows it separates. */
  const air = (): JSX.Element => h("box", { height: 1, flexShrink: 0 });

  /** A column-head row: one blank marker cell the data rows carry, a flex
   * label, then one fixed cell per column, each label aligned the way that
   * column's data rows align so a head sits exactly over what it names.
   * Right is the default because both tables right-align their numbers; the
   * summary's model column is the one left-aligned cell. */
  const headRow = (
    label: string,
    columns: ReadonlyArray<{ readonly label: string; readonly width: number; readonly align?: "left" | "right" }>,
    tail?: JSX.Element,
  ): JSX.Element =>
    h(
      "box",
      { flexDirection: "row", gap: 1, width: "100%", flexShrink: 0 },
      h("text", { fg: theme.text.faint, wrapMode: "none", flexShrink: 0 }, " "),
      h(
        "text",
        { fg: theme.text.faint, wrapMode: "none", truncate: true, flexGrow: 1, flexShrink: 1, minWidth: 0 },
        label,
      ),
      ...columns.map((one) =>
        h(
          "text",
          { fg: theme.text.faint, wrapMode: "none", flexShrink: 0 },
          one.align === "left" ? fit(one.label, one.width) : one.label.padStart(one.width),
        ),
      ),
      ...(tail === undefined ? [] : [tail]),
    );

  const header = (label: string): JSX.Element =>
    headRow(
      label,
      [
        { label: "model", width: MODEL_COLUMN, align: "left" },
        { label: "runs", width: RUNS_COLUMN },
        { label: "tokens", width: TOKENS_COLUMN },
        { label: "cost", width: COST_COLUMN },
      ],
      show(
        () => input.panel.width >= 64,
        () =>
          h("text", { fg: theme.text.faint, wrapMode: "none", flexShrink: 0 }, " ".repeat(BAR_CELLS)),
      ),
    );

  const usageRow = (row: ProfileUsage, at: number): JSX.Element =>
    h(
      "box",
      {
        flexDirection: "row",
        gap: 1,
        width: "100%",
        minWidth: 0,
        // The summary never yields height to the run table: a row that
        // shrank to zero would disappear before the table gave up space.
        flexShrink: 0,
        onMouseUp: () => setSelected(at),
      },
      h("text", { fg: theme.text.base, flexShrink: 0 }, () => (selectionAt() === at ? "▌" : " ")),
      h(
        "text",
        {
          fg: selectionAt() === at ? theme.text.base : theme.text.muted,
          attributes: selectionAt() === at ? TextAttributes.BOLD : undefined,
          wrapMode: "none",
          truncate: true,
          flexGrow: 1,
          flexShrink: 1,
          minWidth: 0,
        },
        rowText(row),
      ),
      h(
        "text",
        { fg: theme.text.faint, wrapMode: "none", flexShrink: 0 },
        row.ref === undefined ? " ".repeat(MODEL_COLUMN) : fit(row.ref, MODEL_COLUMN),
      ),
      h(
        "text",
        { fg: theme.text.base, wrapMode: "none", flexShrink: 0 },
        String(row.runs.length).padStart(RUNS_COLUMN),
      ),
      h(
        "text",
        { fg: theme.text.base, wrapMode: "none", flexShrink: 0 },
        formatTokens(totalTokens(row.tokens)).padStart(TOKENS_COLUMN),
      ),
      h(
        "text",
        { fg: theme.text.base, wrapMode: "none", flexShrink: 0 },
        formatCost(row.cost).padStart(COST_COLUMN),
      ),
      show(
        () => input.panel.width >= 64,
        () =>
          h(
            "text",
            { fg: theme.text.muted, wrapMode: "none", flexShrink: 0 },
            bar(totalTokens(row.tokens), peak()),
          ),
      ),
    );

  /** The band title above the run table: the selected row's label and run
   * count, with a hairline filling the width that is left. The label clips,
   * so a long profile name never wraps the line. */
  const runsBand = (row: ProfileUsage): JSX.Element => {
    const inner = Math.max(0, input.panel.width - 2);
    const label = `▼ ${rowText(row)} · ${row.runs.length} ${row.runs.length === 1 ? "run" : "runs"}${
      row.ref === undefined ? "" : ` · ${row.ref}`
    }`;
    const fill = Math.max(0, inner - label.length - 1);
    return h(
      "box",
      { flexDirection: "row", width: "100%", flexShrink: 0 },
      h("text", { fg: theme.text.muted, wrapMode: "none", truncate: true, flexShrink: 1, minWidth: 0 }, label),
      h(
        "text",
        { fg: theme.border?.base ?? theme.text.faint, wrapMode: "none", flexShrink: 0 },
        ` ${"─".repeat(fill)}`,
      ),
    );
  };

  /** The run table's column header. The token types appear in the footer's
   * order, so the two lines read as one vocabulary. */
  const runsHeader = (): JSX.Element =>
    headRow("run", [
      { label: "in", width: TOKENS_COLUMN },
      { label: "cache↻", width: CACHE_COLUMN },
      { label: "out", width: TOKENS_COLUMN },
      { label: "rsn", width: TOKENS_COLUMN },
      { label: "cost", width: COST_COLUMN },
    ]);

  /** One run of the selected row: the outcome marker, the prompt, then the
   * token types and cost. The types mirror the footer — input, cache
   * read/write, output, reasoning — so a run reads in the same vocabulary
   * the session total does. */
  const runRow = (one: ProfileRun): JSX.Element => {
    const run = one.run;
    return h(
      "box",
      { flexDirection: "row", gap: 1, width: "100%", minWidth: 0, flexShrink: 0 },
      h("text", { fg: run.running ? theme.text.base : theme.text.faint, flexShrink: 0 }, outcomeMark(run)),
      h(
        "text",
        {
          fg: run.running ? theme.text.base : theme.text.muted,
          wrapMode: "none",
          truncate: true,
          flexGrow: 1,
          flexShrink: 1,
          minWidth: 0,
        },
        run.prompt || "(no prompt recorded)",
      ),
      h(
        "text",
        { fg: theme.text.base, wrapMode: "none", flexShrink: 0 },
        formatTokens(run.tokens.input).padStart(TOKENS_COLUMN),
      ),
      h(
        "text",
        { fg: theme.text.faint, wrapMode: "none", flexShrink: 0 },
        `${formatTokens(run.tokens.cacheRead)}/${formatTokens(run.tokens.cacheWrite)}`.padStart(CACHE_COLUMN),
      ),
      h(
        "text",
        { fg: theme.text.base, wrapMode: "none", flexShrink: 0 },
        formatTokens(run.tokens.output).padStart(TOKENS_COLUMN),
      ),
      h(
        "text",
        { fg: theme.text.faint, wrapMode: "none", flexShrink: 0 },
        formatTokens(run.tokens.reasoning).padStart(TOKENS_COLUMN),
      ),
      h(
        "text",
        { fg: theme.text.base, wrapMode: "none", flexShrink: 0 },
        formatCost(run.cost).padStart(COST_COLUMN),
      ),
    );
  };

  const hasAny = () => report().rows.length > 0 && totalTokens(report().totals.tokens) > 0;

  return h(
    "box",
    { flexDirection: "column", width: "100%", height: "100%", paddingLeft: 1, paddingRight: 1 },
    h(
      "box",
      { flexDirection: "row", justifyContent: "space-between", width: "100%", flexShrink: 0 },
      h(
        "box",
        { flexDirection: "row", gap: 1, minWidth: 0, flexShrink: 1 },
        h(
          "text",
          {
            fg: theme.text.base,
            attributes: TextAttributes.BOLD,
            wrapMode: "none",
            truncate: true,
            flexShrink: 1,
            minWidth: 0,
          },
          "Session breakdown",
        ),
        h(
          "text",
          { fg: theme.text.muted, wrapMode: "none", truncate: true, flexShrink: 1, minWidth: 0 },
          () => {
            const rootID = context.data.session.root(input.panel.sessionID);
            return context.data.session.get(rootID)?.title ?? rootID;
          },
        ),
      ),
      h(
        "box",
        { flexShrink: 0, onMouseUp: () => input.panel.close() },
        h("text", { fg: theme.text.muted, wrapMode: "none" }, "×"),
      ),
    ),
    rule(),
    air(),
    show(
      () => hasAny(),
      () =>
        h(
          "box",
          { flexDirection: "column", width: "100%", minWidth: 0 },
          header("agent"),
          h(
            "box",
            { flexDirection: "column", width: "100%", minWidth: 0, flexShrink: 0 },
            () => bands().main.map((row, at) => usageRow(row, at)),
          ),
          show(
            () => bands().rest.length > 0,
            () =>
              h(
                "box",
                { flexDirection: "column", width: "100%", minWidth: 0, flexShrink: 0 },
                air(),
                rule(),
                air(),
                header("profile"),
                h(
                  "box",
                  { flexDirection: "column", width: "100%", flexShrink: 0 },
                  () => {
                    const offset = bands().main.length;
                    return bands().rest.map((row, at) => usageRow(row, at + offset));
                  },
                ),
              ),
          ),
          air(),
          rule(),
          h(
            "box",
            { flexDirection: "row", gap: 1, width: "100%", flexShrink: 0 },
            h(
              "text",
              { fg: theme.text.base, wrapMode: "none", truncate: true, flexShrink: 1, minWidth: 0 },
              () => {
                const now = report();
                return `Σ ${now.totals.runs} runs · ${formatTokens(
                  totalTokens(now.totals.tokens),
                )} tokens · ${formatCost(now.totals.cost)}`;
              },
            ),
          ),
          h(
            "box",
            { flexDirection: "row", width: "100%", flexShrink: 0 },
            h("text", { fg: theme.text.faint, wrapMode: "none", truncate: true }, () => {
              const now = report().totals.tokens;
              return `in ${formatTokens(now.input)} · cache↻ ${formatTokens(now.cacheRead)}/${formatTokens(
                now.cacheWrite,
              )} · out ${formatTokens(now.output)} · rsn ${formatTokens(now.reasoning)}`;
            }),
          ),
          // The run table: the selected row's runs, below the totals, in the
          // space the footer leaves. The function child keeps the table
          // reading the selection as it moves. The region is the one flexible
          // box in the panel and it clips its overflow, so a row with more
          // runs than fit loses the tail of the list and nothing else moves.
          show(
            () => (selectedRow()?.runs.length ?? 0) > 0,
            () =>
              h(
                "box",
                {
                  flexDirection: "column",
                  width: "100%",
                  flexGrow: 1,
                  flexShrink: 1,
                  minHeight: 0,
                  overflow: "hidden",
                },
                air(),
                h(
                  "box",
                  { flexDirection: "column", width: "100%", minWidth: 0, flexShrink: 0 },
                  () => {
                    const row = selectedRow();
                    if (row === undefined || row.runs.length === 0) return null;
                    return [
                      runsBand(row),
                      runsHeader(),
                      h(
                        "box",
                        { flexDirection: "column", width: "100%", minWidth: 0, flexShrink: 0 },
                        row.runs.map((one) => runRow(one)),
                      ),
                    ];
                  },
                ),
              ),
          ),
        ),
    ),
    show(
      () => !hasAny(),
      () =>
        h(
          "box",
          { flexDirection: "row", width: "100%" },
          h("text", { fg: theme.text.muted, wrapMode: "none" }, "No usage in this session yet."),
        ),
    ),
    air(),
    show(
      () => hasAny(),
      () =>
        h(
          "box",
          { flexDirection: "row", gap: 1, width: "100%", flexShrink: 0 },
          h(
            "text",
            {
              fg: theme.text.faint,
              wrapMode: "none",
              truncate: true,
              flexGrow: 1,
              flexShrink: 1,
              minWidth: 0,
            },
            () => sortHint(),
          ),
          h(
            "text",
            { fg: theme.text.faint, wrapMode: "none", flexShrink: 0 },
            "· ↑↓ select",
          ),
          h(
            "text",
            { fg: theme.text.faint, wrapMode: "none", flexShrink: 0 },
            `· esc close (${context.keymap.shortcuts("spectre.subagents.close")[0] ?? "escape"})`,
          ),
        ),
    ),
  );
};
