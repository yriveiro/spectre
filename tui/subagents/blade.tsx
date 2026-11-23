import type { Plugin } from "@opencode/plugin/tui";
import { TextAttributes } from "@opentui/core";
import type { JSX } from "@opentui/solid";
import { createMemo, createSignal } from "solid-js";
import { h, show } from "../render.ts";
import {
  type ProfileRouting,
  type ProfileUsage,
  formatCost,
  formatDuration,
  formatTokens,
  profileLabel,
  rowKey,
  sessionUsage,
  totalTokens,
} from "./usage.ts";

/** Share-bar cells. One cell is the resolution the eye can rank with anyway. */
const BAR_CELLS = 10;

/** Fixed column widths. The header pads to the same widths, so labels sit
 * exactly where the numbers do, and every row pads the same way. */
const MODEL_COLUMN = 26;
const RUNS_COLUMN = 5;
const TOKENS_COLUMN = 7;
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
 * — each row expandable into the runs it spent. The rows partition the
 * session, so the tokens column sums to the footer total across both
 * sections. The keymap layer is created inside the component, so the
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
  // the children under their profiles. Every row's share bar, the run lines
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
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set());

  const toggleExpanded = (row: ProfileUsage): void => {
    if (row.runs.length === 0) return;
    const id = rowKey(row);
    setExpanded((held) => {
      const next = new Set(held);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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
      {
        id: "spectre.subagents.expand",
        title: "Expand selected row",
        bind: "enter",
        run: () => {
          const list = ordered();
          const row = list[Math.min(selected(), list.length - 1)];
          if (row !== undefined) toggleExpanded(row);
        },
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

  /** A full-width hairline: the panel's own width minus its side padding. */
  const rule = (): JSX.Element =>
    h(
      "text",
      { fg: theme.border?.base ?? theme.text.faint, wrapMode: "none" },
      "─".repeat(Math.max(0, input.panel.width - 2)),
    );

  /** One empty row. The table reads better with air between its bands. */
  const air = (): JSX.Element => h("box", { height: 1 });

  /** The band header: the marker and fold columns the data rows carry, as
   * two blank cells of the same width with the same gaps, so the label and
   * every fixed column line up with the row text, then the number columns
   * padded to the widths their data rows use. */
  const header = (label: string): JSX.Element =>
    h(
      "box",
      { flexDirection: "row", gap: 1, width: "100%", flexShrink: 0 },
      h("text", { fg: theme.text.faint, wrapMode: "none", flexShrink: 0 }, " "),
      h("text", { fg: theme.text.faint, wrapMode: "none", flexShrink: 0 }, " "),
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
        label,
      ),
      h(
        "text",
        { fg: theme.text.faint, wrapMode: "none", flexShrink: 0 },
        fit("model", MODEL_COLUMN),
      ),
      h("text", { fg: theme.text.faint, wrapMode: "none", flexShrink: 0 }, "runs".padStart(RUNS_COLUMN)),
      h("text", { fg: theme.text.faint, wrapMode: "none", flexShrink: 0 }, "tokens".padStart(TOKENS_COLUMN)),
      h("text", { fg: theme.text.faint, wrapMode: "none", flexShrink: 0 }, "cost".padStart(COST_COLUMN)),
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
        onMouseUp: () => {
          setSelected(at);
          toggleExpanded(row);
        },
      },
      h("text", { fg: theme.text.base, flexShrink: 0 }, () => (selected() === at ? "▌" : " ")),
      h(
        "text",
        { fg: theme.text.faint, flexShrink: 0 },
        expanded().has(rowKey(row)) ? "▾" : row.runs.length > 0 ? "▸" : " ",
      ),
      h(
        "text",
        {
          fg: selected() === at ? theme.text.base : theme.text.muted,
          attributes: selected() === at ? TextAttributes.BOLD : undefined,
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

  const runDuration = (run: ProfileUsage["runs"][number]["run"]): string =>
    run.started !== undefined && run.ended !== undefined
      ? formatDuration(run.ended - run.started)
      : run.running
        ? "running"
        : "—";

  const runLines = (row: ProfileUsage): JSX.Element =>
    h(
      "box",
      { flexDirection: "column", width: "100%", minWidth: 0 },
      row.runs.map((one) =>
        h(
          "box",
          { flexDirection: "row", width: "100%", minWidth: 0 },
          h("text", { fg: theme.text.base, flexShrink: 0 }, " "),
          h("text", { fg: theme.text.base, flexShrink: 0 }, " "),
          h(
            "text",
            {
              fg: one.run.running ? theme.text.base : theme.text.faint,
              wrapMode: "none",
              truncate: true,
              flexGrow: 1,
              flexShrink: 1,
              minWidth: 0,
            },
            `${outcomeMark(one.run)} ${one.child}: ${one.run.prompt || "(no prompt recorded)"} · ${runDuration(one.run)} · ${formatTokens(
              totalTokens(one.run.tokens),
            )} · ${formatCost(one.run.cost)}${one.run.models.length > 0 ? ` · ${one.run.models.join(", ")}` : ""}`,
          ),
        ),
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
            { flexDirection: "column", width: "100%", minWidth: 0 },
            () => {
              const list = bands().main;
              return list.flatMap((row, at) =>
                expanded().has(rowKey(row)) ? [usageRow(row, at), runLines(row)] : [usageRow(row, at)],
              );
            },
          ),
          show(
            () => bands().rest.length > 0,
            () =>
              h(
                "box",
                { flexDirection: "column", width: "100%", minWidth: 0 },
                air(),
                rule(),
                air(),
                header("profile"),
                h(
                  "box",
                  { flexDirection: "column", width: "100%", flexGrow: 1, flexShrink: 1, minHeight: 0 },
                  () => {
                    const offset = bands().main.length;
                    const list = bands().rest;
                    return list.flatMap((row, at) =>
                      expanded().has(rowKey(row))
                        ? [usageRow(row, at + offset), runLines(row)]
                        : [usageRow(row, at + offset)],
                    );
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
            "· ↑↓ select · ↵ runs",
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
