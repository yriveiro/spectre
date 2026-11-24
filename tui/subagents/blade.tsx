import type { Plugin } from "@opencode/plugin/tui";
import type { JSX } from "@opentui/solid";
import { createMemo } from "solid-js";
import { blade } from "../blade.tsx";
import { bar, type Column } from "../blade-layout.ts";
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

/** The prompt band's line cap. A constant, so the band keeps its shape
 * whatever the prompt's length and the run list above yields the space. */
const PROMPT_LINES = 4;

/** The outcome mark before a run row: running, failed, interrupted,
 * succeeded, or an execution a shutdown cut off before it idled. */
const outcomeMark = (run: ProfileRun["run"]): string => {
  if (run.running) return "●";
  switch (run.outcome) {
    case "failed":
      return "✗";
    case "interrupted":
      return "⌁";
    case "succeeded":
      return "✓";
    default:
      return "·";
  }
};

/** The row label: the profile's name, `main` for the root's agent, or the agent when unrouted. */
const rowText = (row: ProfileUsage): string =>
  row.kind === "main" ? row.agent : profileLabel(row);

/**
 * The session panel: two sections over one partition — the main agent's own
 * spend, then the routing profiles, whatever stayed unrouted, and compaction
 * — then the selected row's run table, and the prompt band below it, reading
 * the run selected in the table the same way the table reads the row
 * selected above it. The rows partition the session, so the tokens column
 * sums to the footer total across both sections.
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
}): JSX.Element => {
  const context = input.context;

  // One walk of the family per change, rooted at the family root: a panel
  // opened on a child still books the root's spend under the main agent and
  // the children under their profiles. Every column, the run table and the
  // footer read this memo, so a redraw never re-folds the family, and a
  // message landing mid-render cannot give two rows different totals.
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

  const peak = (): number => Math.max(0, ...report().rows.map((one) => totalTokens(one.tokens)));

  /** The panel's two sections: the main agent's own spend, then the profiles
   * (plus unrouted and compaction), in the report's own order. */
  const sections = (): ReadonlyArray<{
    readonly header: string;
    readonly rows: ProfileUsage[];
  }> => {
    const main = report().rows.filter((row) => row.kind === "main");
    const rest = report().rows.filter((row) => row.kind !== "main");
    return [
      { header: "agent", rows: main },
      ...(rest.length > 0 ? [{ header: "profile", rows: rest }] : []),
    ];
  };

  const runColumns: ReadonlyArray<Column<ProfileRun>> = [
    {
      header: "run",
      tone: (one) => (one.run.running ? "base" : "muted"),
      cell: (one) => one.run.prompt || "(no prompt recorded)",
    },
    { header: "in", width: 7, align: "right", cell: (one) => formatTokens(one.run.tokens.input) },
    {
      header: "cache↻",
      width: 9,
      hideBelow: 56,
      align: "right",
      tone: "faint",
      cell: (one) =>
        `${formatTokens(one.run.tokens.cacheRead)}/${formatTokens(one.run.tokens.cacheWrite)}`,
    },
    { header: "out", width: 7, align: "right", cell: (one) => formatTokens(one.run.tokens.output) },
    {
      header: "rsn",
      width: 7,
      hideBelow: 72,
      align: "right",
      tone: "faint",
      cell: (one) => formatTokens(one.run.tokens.reasoning),
    },
    {
      header: "cost",
      width: 8,
      hideBelow: 40,
      align: "right",
      cell: (one) => formatCost(one.run.cost),
    },
  ];

  return blade<ProfileUsage, ProfileRun>({
    context,
    panel: input.panel,
    id: "spectre.subagents",
    title: "Session breakdown",
    subtitle: () => {
      const rootID = context.data.session.root(input.panel.sessionID);
      return context.data.session.get(rootID)?.title ?? rootID;
    },
    empty: () => "No usage in this session yet.",
    sections,
    columns: [
      { header: "agent", cell: rowText },
      {
        header: "model",
        // Measured from the refs the rows carry, so a wide panel shows the
        // whole ref and a narrow one shrinks it before the label's floor.
        // Left-aligned: a shrunk column clips the ref with an ellipsis.
        width: { min: 12 },
        hideBelow: 46,
        align: "left",
        tone: "faint",
        cell: (row) => row.ref ?? "",
      },
      {
        header: "runs",
        width: 5,
        hideBelow: 52,
        align: "right",
        cell: (row) => String(row.runs.length),
      },
      {
        header: "tokens",
        width: 7,
        align: "right",
        cell: (row) => formatTokens(totalTokens(row.tokens)),
      },
      {
        header: "cost",
        width: 8,
        hideBelow: 40,
        align: "right",
        cell: (row) => formatCost(row.cost),
      },
      {
        header: "",
        width: 10,
        hideBelow: 62,
        tone: "muted",
        cell: (row) => bar(totalTokens(row.tokens), peak(), 10),
      },
    ],
    summary: () => {
      const now = report();
      const tokens = now.totals.tokens;
      return [
        {
          text: `Σ ${now.totals.runs} runs · ${formatTokens(totalTokens(now.totals.tokens))} tokens · ${formatCost(now.totals.cost)}`,
        },
        {
          text: `in ${formatTokens(tokens.input)} · cache↻ ${formatTokens(tokens.cacheRead)}/${formatTokens(tokens.cacheWrite)} · out ${formatTokens(tokens.output)} · rsn ${formatTokens(tokens.reasoning)}`,
          tone: "faint",
        },
      ];
    },
    detail: {
      table: {
        rows: (row) => row.runs,
        bandTitle: (row) =>
          `▼ ${rowText(row)} · ${row.runs.length} ${row.runs.length === 1 ? "run" : "runs"}${
            row.ref === undefined ? "" : ` · ${row.ref}`
          }`,
        marker: (one) => ({
          text: outcomeMark(one.run),
          tone: one.run.running ? "base" : "faint",
        }),
        columns: runColumns,
      },
      bands: (_row, picked) =>
        picked === undefined
          ? []
          : [{ label: "", value: picked.run.promptText || "(no prompt recorded)" }],
      cap: PROMPT_LINES,
      labelColumn: 0,
      indent: 2,
    },
  });
};
