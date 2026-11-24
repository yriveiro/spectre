import type { Plugin } from "@opencode/plugin/tui";
import { TextAttributes } from "@opentui/core";
import type { JSX } from "@opentui/solid";
import { createMemo, createSignal } from "solid-js";
import { clampIndex, h, show, wrapLines } from "../render.ts";
import {
  formatCost,
  formatTokens,
  type ProfileRouting,
  type ProfileRun,
  type ProfileUsage,
  profileLabel,
  sessionUsage,
  type SubagentRun,
  totalTokens,
} from "./usage.ts";

/** Share-bar cells. One cell is the resolution the eye can rank with anyway. */
const BAR_CELLS = 10;

/**
 * Every column width is derived from the panel's inner width and the rows
 * the panel actually holds. The host clamps the pane anywhere from half a
 * wide terminal down to 24 columns (`clampSessionPaneWidth` at v2.3.0), so
 * a row of fixed columns would overflow a narrow pane and collide with its
 * neighbour, while a wide pane would strand its spare width in the label
 * alone. Zero means the column is dropped: the panel stays legible by
 * losing detail, never by overlapping. Tokens and cost are the statistics,
 * so they stay at every width; the model, runs and share-bar columns join
 * as the width admits them, and the model column is sized to the longest
 * ref the rows carry so a wide panel shows it whole instead of clipping
 * to a fixed guess.
 */
type SummaryColumns = {
  readonly model: number;
  readonly runs: number;
  readonly tokens: number;
  readonly cost: number;
  readonly bar: number;
};

const summaryColumns = (inner: number, maxRef: number): SummaryColumns => {
  const cost = inner >= 40 ? 8 : 0;
  const runs = inner >= 52 ? 5 : 0;
  const bar = inner >= 62 ? BAR_CELLS : 0;
  // The gaps between the visible cells of a full row: marker, label,
  // model, runs, tokens, cost, bar.
  const gaps = 3 + (runs > 0 ? 1 : 0) + (cost > 0 ? 1 : 0) + (bar > 0 ? 1 : 0);
  // Thirteen is the marker plus the label's floor of twelve: the model
  // column never squeezes the row's name below that.
  const budget = inner - 13 - runs - 7 - cost - bar - gaps;
  return {
    model: inner >= 46 ? Math.max(12, Math.min(maxRef, budget)) : 0,
    runs,
    tokens: 7,
    cost,
    bar,
  };
};

/** The run table's numbers: in, out and cost stay at every width — a run
 * without its spend is not a statistic — and the cache read/write and
 * reasoning columns join as the width admits them. */
type RunColumns = {
  readonly input: number;
  readonly cache: number;
  readonly output: number;
  readonly reasoning: number;
  readonly cost: number;
};

const runColumns = (inner: number): RunColumns => ({
  input: 7,
  cache: inner >= 56 ? 9 : 0,
  output: 7,
  reasoning: inner >= 72 ? 7 : 0,
  cost: inner >= 40 ? 8 : 0,
});

/** One column head: a label over the fixed cell it names. */
type HeadColumn = {
  readonly label: string;
  readonly width: number;
  readonly align?: "left" | "right";
};

/** The summary head's columns, one per column the width admits. The rows
 * call `summaryCells` with the same budget, so a dropped column vanishes
 * from the head and the rows in the same draw. */
const summaryHeadColumns = (cols: SummaryColumns): ReadonlyArray<HeadColumn> =>
  (
    [
      { label: "model", width: cols.model, align: "left" },
      { label: "runs", width: cols.runs },
      { label: "tokens", width: cols.tokens },
      { label: "cost", width: cols.cost },
    ] as const satisfies ReadonlyArray<HeadColumn>
  ).filter((one) => one.width > 0);

/** The bar cells the head claims silently when the rows draw a share bar,
 * so its labels sit exactly where the numbers do. */
const barHead = (theme: Plugin.Context["theme"], cols: SummaryColumns): JSX.Element | undefined =>
  cols.bar > 0
    ? h("text", { fg: theme.text.faint, wrapMode: "none", flexShrink: 0 }, " ".repeat(BAR_CELLS))
    : undefined;

/** The run table's head columns, one per column the width admits. */
const runHeadColumns = (cols: RunColumns): ReadonlyArray<HeadColumn> =>
  (
    [
      { label: "in", width: cols.input },
      { label: "cache↻", width: cols.cache },
      { label: "out", width: cols.output },
      { label: "rsn", width: cols.reasoning },
      { label: "cost", width: cols.cost },
    ] as const satisfies ReadonlyArray<HeadColumn>
  ).filter((one) => one.width > 0);

/** The summary row's cells after the label, in `summaryHeadColumns`' order:
 * one fixed cell per column the width admits, the tokens count always. */
const summaryCells = (
  theme: Plugin.Context["theme"],
  cols: SummaryColumns,
  row: ProfileUsage,
  peak: number,
): ReadonlyArray<JSX.Element> => [
  ...(cols.model > 0
    ? [
        h(
          "text",
          { fg: theme.text.faint, wrapMode: "none", flexShrink: 0 },
          row.ref === undefined ? " ".repeat(cols.model) : fit(row.ref, cols.model),
        ),
      ]
    : []),
  ...(cols.runs > 0
    ? [
        h(
          "text",
          { fg: theme.text.base, wrapMode: "none", flexShrink: 0 },
          String(row.runs.length).padStart(cols.runs),
        ),
      ]
    : []),
  h(
    "text",
    { fg: theme.text.base, wrapMode: "none", flexShrink: 0 },
    formatTokens(totalTokens(row.tokens)).padStart(cols.tokens),
  ),
  ...(cols.cost > 0
    ? [
        h(
          "text",
          { fg: theme.text.base, wrapMode: "none", flexShrink: 0 },
          formatCost(row.cost).padStart(cols.cost),
        ),
      ]
    : []),
  ...(cols.bar > 0
    ? [
        h(
          "text",
          { fg: theme.text.muted, wrapMode: "none", flexShrink: 0 },
          bar(totalTokens(row.tokens), peak),
        ),
      ]
    : []),
];

/** The run row's cells after the prompt, in `runHeadColumns`' order. */
const runCells = (
  theme: Plugin.Context["theme"],
  cols: RunColumns,
  run: SubagentRun,
): ReadonlyArray<JSX.Element> => [
  h(
    "text",
    { fg: theme.text.base, wrapMode: "none", flexShrink: 0 },
    formatTokens(run.tokens.input).padStart(cols.input),
  ),
  ...(cols.cache > 0
    ? [
        h(
          "text",
          { fg: theme.text.faint, wrapMode: "none", flexShrink: 0 },
          `${formatTokens(run.tokens.cacheRead)}/${formatTokens(run.tokens.cacheWrite)}`.padStart(
            cols.cache,
          ),
        ),
      ]
    : []),
  h(
    "text",
    { fg: theme.text.base, wrapMode: "none", flexShrink: 0 },
    formatTokens(run.tokens.output).padStart(cols.output),
  ),
  ...(cols.reasoning > 0
    ? [
        h(
          "text",
          { fg: theme.text.faint, wrapMode: "none", flexShrink: 0 },
          formatTokens(run.tokens.reasoning).padStart(cols.reasoning),
        ),
      ]
    : []),
  ...(cols.cost > 0
    ? [
        h(
          "text",
          { fg: theme.text.base, wrapMode: "none", flexShrink: 0 },
          formatCost(run.cost).padStart(cols.cost),
        ),
      ]
    : []),
];

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

/** The prompt band's line cap. A constant, so the band keeps its shape
 * whatever the prompt's length and the run list above yields the space. */
const PROMPT_LINES = 4;

/**
 * The session panel: two sections over one partition — the main agent's own
 * spend, then the routing profiles, whatever stayed unrouted, and compaction
 * — then the selected row's run table, and the prompt band below it, reading
 * the run selected in the table the same way the table reads the row
 * selected above it. The rows partition the session, so the tokens column
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

  // The panel's inner width after its side padding. The host hands the
  // slot a fresh width on a resize, so the component re-runs and both
  // tables re-flow.
  const inner = Math.max(0, input.panel.width - 2);

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

  // The column budgets both tables derive from. The model column is sized
  // to the longest ref the rows actually carry, so a wide panel shows a
  // whole ref instead of clipping it to a fixed guess.
  const maxRef = (): number =>
    report().rows.reduce((max, one) => Math.max(max, one.ref?.length ?? 0), 0);
  const cols = summaryColumns(inner, maxRef());
  const runCols = runColumns(inner);

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

  /** The run the third band reads, as a position in the selected row's runs
   * — the same two-level selection the agent rows hold over the run table,
   * one level deeper. Clamped, so moving the summary selection to a row
   * with fewer runs keeps the band pointing at a real run. */
  const [selectedRun, setSelectedRun] = createSignal(0);

  /** The clamped selection index. A reroute can shorten the row list under a
   * selection, and the marker, the bold row and the runs table must all agree
   * on which row is selected, so every read goes through this clamp. */
  const selectionAt = (): number => clampIndex(selected(), ordered().length);

  /** The row the selection points at, so the run table always names a real
   * row even after the list shrank under the selection. */
  const selectedRow = (): ProfileUsage | undefined => ordered()[selectionAt()];

  /** The clamped run position, so the third band always names a real run of
   * the selected row. */
  const selectedRunAt = (): number =>
    clampIndex(selectedRun(), selectedRow()?.runs.length ?? 0);

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

  /** A full-width hairline: the panel's inner width, which is what the rows
   * occupy. It never shrinks, so a short panel loses run rows, not rules. */
  const rule = (): JSX.Element =>
    h(
      "text",
      { fg: theme.border?.base ?? theme.text.faint, wrapMode: "none", flexShrink: 0 },
      "─".repeat(inner),
    );

  /** One empty row, never a shareable one. The table reads better with air
   * between its bands, and shrinking air would move the rows it separates. */
  const air = (): JSX.Element => h("box", { height: 1, flexShrink: 0 });

  /** A column-head row: one blank marker cell the data rows carry, a flex
   * label, then one fixed cell per column, each label aligned the way that
   * column's data rows align so a head sits exactly over what it names.
   * Right is the default because both tables right-align their numbers; the
   * summary's model column is the one left-aligned cell. */
  const headRow = (label: string, columns: ReadonlyArray<HeadColumn>, tail?: JSX.Element): JSX.Element =>
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
    headRow(label, summaryHeadColumns(cols), barHead(theme, cols));

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
      ...summaryCells(theme, cols, row, peak()),
    );

  /** The band title above the run table: the selected row's label and run
   * count, with a hairline filling the width that is left. The label clips,
   * so a long profile name never wraps the line. */
  const runsBand = (row: ProfileUsage): JSX.Element => {
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
  const runsHeader = (): JSX.Element => headRow("run", runHeadColumns(runCols));

  /** One run of the selected row: the outcome marker, the prompt, then the
   * token types and cost. The types mirror the footer — input, cache
   * read/write, output, reasoning — so a run reads in the same vocabulary
   * the session total does. Selecting a run drives the prompt band below. */
  const runRow = (one: ProfileRun, at: number): JSX.Element => {
    const run = one.run;
    const chosen = () => selectedRunAt() === at;
    return h(
      "box",
      {
        flexDirection: "row",
        gap: 1,
        width: "100%",
        minWidth: 0,
        flexShrink: 0,
        onMouseUp: () => setSelectedRun(at),
      },
      h("text", { fg: run.running ? theme.text.base : theme.text.faint, flexShrink: 0 }, outcomeMark(run)),
      h(
        "text",
        {
          fg: chosen() || run.running ? theme.text.base : theme.text.muted,
          attributes: chosen() ? TextAttributes.BOLD : undefined,
          wrapMode: "none",
          truncate: true,
          flexGrow: 1,
          flexShrink: 1,
          minWidth: 0,
        },
        run.prompt || "(no prompt recorded)",
      ),
      ...runCells(theme, runCols, run),
    );
  };

  /** The selected run's prompt, as the third band under the run table: the
   * whole text the row label clips, folded to the panel's width and capped,
   * so the band keeps a constant shape whatever the prompt's length and the
   * run list above yields the space. */
  const promptBand = (one: ProfileRun): JSX.Element =>
    h(
      "box",
      { flexDirection: "column", width: "100%", minWidth: 0, flexShrink: 0 },
      air(),
      rule(),
      air(),
      ...wrapLines(
        one.run.promptText || "(no prompt recorded)",
        Math.max(1, inner - 2),
        PROMPT_LINES,
      ).map((line) =>
        h("text", { fg: theme.text.muted, wrapMode: "none", flexShrink: 0 }, `  ${line}`),
      ),
    );

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
          // space the footer leaves, and the prompt band below it — the
          // third section, reading the run selected in the table the same
          // way the table reads the row selected above it. The function
          // children keep both reading their selections as they move. The
          // region is the one flexible box in the panel and it clips its
          // overflow; inside it the run list yields to the band, so a row
          // with more runs than fit loses the tail of the list and nothing
          // else moves.
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
                  {
                    flexDirection: "column",
                    width: "100%",
                    minWidth: 0,
                    flexGrow: 1,
                    flexShrink: 1,
                    minHeight: 0,
                    overflow: "hidden",
                  },
                  () => {
                    const row = selectedRow();
                    if (row === undefined || row.runs.length === 0) return null;
                    return [
                      runsBand(row),
                      runsHeader(),
                      h(
                        "box",
                        { flexDirection: "column", width: "100%", minWidth: 0, flexShrink: 0 },
                        () => row.runs.map((one, at) => runRow(one, at)),
                      ),
                    ];
                  },
                ),
                h(
                  "box",
                  { flexDirection: "column", width: "100%", minWidth: 0, flexShrink: 0 },
                  () => {
                    const run = selectedRow()?.runs[selectedRunAt()];
                    if (run === undefined) return null;
                    return promptBand(run);
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
