import type { Plugin } from "@opencode/plugin/tui";
import { TextAttributes } from "@opentui/core";
import type { JSX } from "@opentui/solid";
import { h, show } from "../render.ts";
import { formatCost, formatTokens, profileLabel, type SessionUsage, totalTokens } from "./usage.ts";

/** Rows the compact box shows before folding the rest into `+N more`. */
const COMPACT_ROWS = 5;

const usedRows = (report: SessionUsage) => report.rows.filter((one) => totalTokens(one.tokens) > 0);

/**
 * The sidebar box: one line per spending group — the main agent, the routing
 * profiles, whatever stayed unrouted — with its running state, total tokens,
 * and cost. Per-run and per-model numbers do not fit the sidebar's width;
 * the panel carries them. The click surface mirrors the tools box: the
 * header row toggles this box's own collapse, and the `⏱ see session statistics`
 * row below an empty row opens the session panel. No handler sits inside
 * another's subtree, and the action row renders in both states so the panel
 * stays reachable while the rows are folded away.
 */
export const subagentsSidebar = (input: {
  readonly theme: Plugin.Context["theme"];
  readonly report: () => SessionUsage;
  readonly open: () => boolean;
  readonly onToggle: () => void;
  readonly onOpenPanel: () => void;
}): JSX.Element =>
  show(
    () => totalTokens(input.report().totals.tokens) > 0,
    () =>
      h(
        "box",
        { flexDirection: "column", width: "100%" },
        h(
          "box",
          { flexDirection: "row", gap: 1, width: "100%", onMouseUp: input.onToggle },
          h("text", { fg: input.theme.text.base, flexShrink: 0 }, () => (input.open() ? "▼" : "▶")),
          h(
            "text",
            {
              fg: input.theme.text.base,
              attributes: TextAttributes.BOLD,
              wrapMode: "none",
              flexShrink: 0,
            },
            "Session",
          ),
          show(
            () => !input.open(),
            () =>
              h("text", { fg: input.theme.text.muted, wrapMode: "none", flexShrink: 0 }, () => {
                const now = input.report();
                return `(${usedRows(now).length} · ${formatTokens(totalTokens(now.totals.tokens))} · ${formatCost(
                  now.totals.cost,
                )})`;
              }),
          ),
        ),
        show(
          () => input.open(),
          () =>
            h("box", { flexDirection: "column", width: "100%" }, () => {
              const rows = usedRows(input.report()).slice(0, COMPACT_ROWS);
              const rest = usedRows(input.report()).length - rows.length;
              const items = rows.map((row) =>
                h(
                  "box",
                  {
                    flexDirection: "row",
                    justifyContent: "space-between",
                    width: "100%",
                    gap: 1,
                    minWidth: 0,
                  },
                  h(
                    "box",
                    { flexDirection: "row", gap: 1, minWidth: 0, flexGrow: 1, flexShrink: 1 },
                    h(
                      "text",
                      {
                        fg: row.running ? input.theme.text.base : input.theme.text.faint,
                        flexShrink: 0,
                      },
                      row.running ? "●" : "○",
                    ),
                    h(
                      "text",
                      {
                        fg: row.running ? input.theme.text.base : input.theme.text.muted,
                        wrapMode: "none",
                        truncate: true,
                        flexGrow: 1,
                        flexShrink: 1,
                        minWidth: 0,
                      },
                      profileLabel(row),
                    ),
                  ),
                  h(
                    "text",
                    {
                      fg: row.running ? input.theme.text.base : input.theme.text.muted,
                      wrapMode: "none",
                      flexShrink: 0,
                    },
                    `${formatTokens(totalTokens(row.tokens))} ${formatCost(row.cost)}`,
                  ),
                ),
              );
              return rest > 0
                ? [
                    ...items,
                    h(
                      "box",
                      { flexDirection: "row", width: "100%" },
                      h(
                        "text",
                        { fg: input.theme.text.faint, wrapMode: "none", truncate: true },
                        `+${rest} more`,
                      ),
                    ),
                  ]
                : items;
            }),
        ),
        h("box", { height: 1 }),
        h(
          "box",
          { flexDirection: "row", gap: 1, width: "100%", onMouseUp: input.onOpenPanel },
          h("text", { fg: input.theme.text.muted, flexShrink: 0 }, "⏱"),
          h("text", { fg: input.theme.text.muted, wrapMode: "none" }, "see session statistics"),
        ),
      ),
  );
