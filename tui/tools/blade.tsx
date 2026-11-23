import type { Plugin } from "@opencode/plugin/tui";
import { TextAttributes } from "@opentui/core";
import type { JSX } from "@opentui/solid";
import { createMemo, createSignal } from "solid-js";
import { h, show } from "../render.ts";
import {
  displayName,
  formatTokens,
  maxTokens,
  type ToolUsage,
  toolUsage,
  totalTokens,
} from "./usage.ts";

/** Share-bar cells. One cell is the resolution the eye can rank with anyway. */
const BAR_CELLS = 10;

const bar = (tokens: number, peak: number): string => {
  if (peak <= 0) return "";
  const filled = Math.max(1, Math.round((tokens / peak) * BAR_CELLS));
  return "█".repeat(Math.min(BAR_CELLS, filled));
};

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
 * The session panel: the extended table the sidebar's compact box opens.
 * Rows carry calls and total tokens; the by-type numbers live in the expand
 * line and the session footer, because the panel is narrower than the table
 * that would hold them as columns.
 *
 * The keymap layer is created inside the component, so the panel's keys stop
 * existing the moment the host closes it, and `enabled` keeps them from
 * firing while the panel is up but the prompt owns the keyboard.
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
  readonly sortBy: () => "calls" | "tokens";
  readonly onSortToggle: () => void;
}): JSX.Element => {
  const context = input.context;
  const theme = context.theme;

  // One walk of the transcript per change. Every row's share bar, the footer
  // and the empty-state branch read this memo, so a redraw never re-folds the
  // message list, and a message landing mid-render cannot give two rows
  // different totals.
  const report = createMemo(() => {
    const boundary = context.data.session.get(input.panel.sessionID)?.revert?.messageID;
    return toolUsage(context.data.session.message.list(input.panel.sessionID), boundary);
  });

  const rows = () => {
    const by = input.sortBy();
    const tools = [...report().tools];
    if (by === "tokens") {
      tools.sort(
        (a, b) => totalTokens(b.tokens) - totalTokens(a.tokens) || a.name.localeCompare(b.name),
      );
    }
    return tools;
  };

  const [selected, setSelected] = createSignal(0);
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set());

  const toggleExpanded = (name: string): void => {
    setExpanded((held) => {
      const next = new Set(held);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const move = (delta: number): void => {
    const count = rows().length;
    if (count === 0) return;
    setSelected((at) => Math.min(count - 1, Math.max(0, at + delta)));
  };

  context.keymap.layer(() => ({
    enabled: () => input.panel.focused,
    commands: [
      {
        id: "spectre.tools.close",
        title: "Close tools panel",
        bind: "escape",
        run: () => input.panel.close(),
      },
      {
        id: "spectre.tools.sort",
        title: "Sort tools by tokens or calls",
        bind: "t",
        run: () => input.onSortToggle(),
      },
      {
        id: "spectre.tools.expand",
        title: "Expand selected tool",
        bind: "enter",
        run: () => {
          const row = rows()[selected()];
          if (row !== undefined) toggleExpanded(row.name);
        },
      },
      { bind: "up", run: () => move(-1) },
      { bind: "down", run: () => move(1) },
    ],
  }));

  const rowLine = (one: ToolUsage, at: number): JSX.Element =>
    h(
      "box",
      {
        flexDirection: "row",
        gap: 1,
        width: "100%",
        minWidth: 0,
        onMouseUp: () => {
          setSelected(at);
          toggleExpanded(one.name);
        },
      },
      h("text", { fg: theme.text.base, flexShrink: 0 }, () => (selected() === at ? "▌" : " ")),
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
        displayName(one.name),
      ),
      h(
        "text",
        { fg: theme.text.base, wrapMode: "none", flexShrink: 0 },
        String(one.calls).padStart(4),
      ),
      h(
        "text",
        { fg: theme.text.base, wrapMode: "none", flexShrink: 0 },
        formatTokens(totalTokens(one.tokens)).padStart(7),
      ),
      show(
        () => input.panel.width >= 48,
        () =>
          h(
            "text",
            { fg: theme.text.muted, wrapMode: "none", flexShrink: 0 },
            bar(totalTokens(one.tokens), maxTokens(report().tools)),
          ),
      ),
    );

  const expandLine = (one: ToolUsage): JSX.Element =>
    h(
      "box",
      { flexDirection: "row", width: "100%", minWidth: 0 },
      h("text", { fg: theme.text.base, flexShrink: 0 }, " "),
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
        breakdown(one),
      ),
    );

  const sortLabel = (): { readonly column: string; readonly hint: string } =>
    input.sortBy() === "tokens"
      ? {
          column: "tokens ▾",
          hint: `sort calls (${context.keymap.shortcuts("spectre.tools.sort")[0] ?? "t"})`,
        }
      : {
          column: "calls ▾",
          hint: `sort tokens (${context.keymap.shortcuts("spectre.tools.sort")[0] ?? "t"})`,
        };

  /** A full-width hairline: the panel's own width minus its side padding. */
  const rule = (): JSX.Element =>
    h(
      "text",
      { fg: theme.border?.base ?? theme.text.faint, wrapMode: "none" },
      "─".repeat(Math.max(0, input.panel.width - 2)),
    );

  /**
   * One empty row. The panel has height to spare, and the table reads better
   * with air between its bands than pressed against itself.
   */
  const air = (): JSX.Element => h("box", { height: 1 });

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
          "Tools",
        ),
        h(
          "text",
          { fg: theme.text.muted, wrapMode: "none", truncate: true, flexShrink: 1, minWidth: 0 },
          () => context.data.session.get(input.panel.sessionID)?.title ?? input.panel.sessionID,
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
      () => report().tools.length > 0,
      () =>
        h(
          "box",
          { flexDirection: "column", width: "100%", minWidth: 0 },
          h(
            "box",
            {
              flexDirection: "row",
              gap: 1,
              width: "100%",
              flexShrink: 0,
              onMouseUp: () => input.onSortToggle(),
            },
            h("text", { fg: theme.text.base, flexShrink: 0 }, " "),
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
              "tool",
            ),
            h("text", { fg: theme.text.faint, wrapMode: "none", flexShrink: 0 }, () =>
              sortLabel().column.padStart(9),
            ),
          ),
          rule(),
          air(),
          h(
            "box",
            { flexDirection: "column", width: "100%", flexGrow: 1, flexShrink: 1, minHeight: 0 },
            () => {
              const list = rows();
              return list.flatMap((one, at) =>
                expanded().has(one.name) ? [rowLine(one, at), expandLine(one)] : [rowLine(one, at)],
              );
            },
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
                return `Σ ${now.tools.length} tools · ${now.totals.calls} calls · ${formatTokens(
                  totalTokens(now.totals),
                )} tokens`;
              },
            ),
          ),
          h(
            "box",
            { flexDirection: "row", width: "100%", flexShrink: 0 },
            h("text", { fg: theme.text.faint, wrapMode: "none", truncate: true }, () => {
              const now = report();
              const outside = now.prose > 0 ? ` · ${formatTokens(now.prose)} in prose turns` : "";
              return `in ${formatTokens(now.totals.input)} · cache↻ ${formatTokens(now.totals.cacheRead)}/${formatTokens(
                now.totals.cacheWrite,
              )} · out ${formatTokens(now.totals.output)} · rsn ${formatTokens(now.totals.reasoning)}${outside}`;
            }),
          ),
        ),
    ),
    show(
      () => report().tools.length === 0,
      () =>
        h(
          "box",
          { flexDirection: "row", width: "100%" },
          h("text", { fg: theme.text.muted, wrapMode: "none" }, "No tool calls yet."),
        ),
    ),
    air(),
    show(
      () => report().tools.length > 0,
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
            () => sortLabel().hint,
          ),
          h(
            "text",
            { fg: theme.text.faint, wrapMode: "none", flexShrink: 0 },
            "· ↑↓ select · ↵ expand",
          ),
          h(
            "text",
            { fg: theme.text.faint, wrapMode: "none", flexShrink: 0 },
            `· esc close (${context.keymap.shortcuts("spectre.tools.close")[0] ?? "escape"})`,
          ),
        ),
    ),
  );
};
