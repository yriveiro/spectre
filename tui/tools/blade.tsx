import type { Plugin } from "@opencode/plugin/tui";
import type { JSX } from "@opentui/solid";
import { createMemo } from "solid-js";
import { type BladeSpec, blade } from "../blade.tsx";
import { bar, type Column } from "../blade-layout.ts";
import {
  displayName,
  formatTokens,
  type ToolUsage,
  toolUsage,
  totalTokens,
} from "./usage.ts";

/** One tool's by-type spend, the words the expand line shows. */
const breakdown = (one: ToolUsage): string => {
  const parts = [
    `in ${formatTokens(one.tokens.input)}`,
    `cache↻ ${formatTokens(one.tokens.cacheRead)}/${formatTokens(one.tokens.cacheWrite)}`,
    `out ${formatTokens(one.tokens.output)}`,
    `rsn ${formatTokens(one.tokens.reasoning)}`,
  ];
  const shared = one.shared > 0 ? ` · ${one.shared} of ${one.calls} shared, pro-rated` : "";
  return `${parts.join(" · ")}${shared}`;
};

/**
 * The tools session panel: one row per tool the session called, its calls
 * and tokens, and the by-type numbers on the expand line under a selected
 * row. The panel is narrower than the table that would hold the types as
 * columns, so they live on the expand line and in the session footer.
 */
export const toolsBlade = (input: {
  readonly context: Plugin.Context;
  readonly panel: {
    readonly name: string;
    readonly sessionID: string;
    readonly width: number;
    readonly focused: boolean;
    readonly close: () => void;
  };
}): JSX.Element => {
  const context = input.context;

  // One walk of the transcript per change: every row's share bar, the
  // footer and the empty branch read this memo, so a redraw never re-folds
  // the message list, and a message landing mid-render cannot give two
  // rows different totals.
  const report = createMemo(() => {
    const boundary = context.data.session.get(input.panel.sessionID)?.revert?.messageID;
    return toolUsage(context.data.session.message.list(input.panel.sessionID), boundary);
  });

  // The tools in the report's own order: usage returns them sorted by
  // calls, which is the order the panel shows.
  const rows = (): ReadonlyArray<ToolUsage> => report().tools;

  const peak = (): number =>
    report().tools.reduce((max, one) => Math.max(max, totalTokens(one.tokens)), 0);

  const columns: ReadonlyArray<Column<ToolUsage>> = [
    { header: "tool", cell: (one) => displayName(one.name) },
    {
      header: "calls",
      width: 6,
      align: "right",
      cell: (one) => String(one.calls),
    },
    {
      header: "tokens",
      width: 7,
      align: "right",
      cell: (one) => formatTokens(totalTokens(one.tokens)),
    },
    {
      header: "",
      width: 10,
      hideBelow: 46,
      tone: "muted",
      cell: (one) => bar(totalTokens(one.tokens), peak(), 10),
    },
  ];

  return blade<ToolUsage>({
    context,
    panel: input.panel,
    id: "spectre.tools",
    title: "Tools",
    subtitle: () => context.data.session.get(input.panel.sessionID)?.title ?? input.panel.sessionID,
    empty: () => (report().tools.length === 0 ? "No tool calls yet." : undefined),
    sections: () => [{ rows: rows() }],
    columns,
    // The expand line carries the by-type spend; `enter` folds it, and a
    // tool's name keys the fold so the order keeps it open.
    expand: (one) => breakdown(one),
    rowKey: (one) => one.name,
    summary: () => {
      const now = report();
      const outside = now.prose > 0 ? ` · ${formatTokens(now.prose)} in prose turns` : "";
      return [
        {
          text: `Σ ${now.tools.length} tools · ${now.totals.calls} calls · ${formatTokens(totalTokens(now.totals))} tokens`,
        },
        {
          text: `in ${formatTokens(now.totals.input)} · cache↻ ${formatTokens(now.totals.cacheRead)}/${formatTokens(now.totals.cacheWrite)} · out ${formatTokens(now.totals.output)} · rsn ${formatTokens(now.totals.reasoning)}${outside}`,
          tone: "faint",
        },
      ];
    },
  });
};
