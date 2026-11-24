import type { Plugin } from "@opencode/plugin/tui";
import { TextAttributes } from "@opentui/core";
import type { JSX } from "@opentui/solid";
import { createMemo, createSignal } from "solid-js";
import { h, show } from "../render.ts";
import {
  type DetailBand,
  expandBands,
  formatConfidence,
  type JudgeView,
  type RoutingCall,
  routingCalls,
  routingTotals,
} from "./history.ts";

/** The time column; epoch milliseconds read as `14:32`. */
const clock = (at: number | undefined): string => {
  if (at === undefined) return "--:--";
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

/**
 * The judge column: the profile the judge spent, the caller's own named
 * profile, the status word of an answer that is not a decision, or the reason
 * a decision never happened.
 */
const judgeCell = (one: RoutingCall): string => {
  if (one.status !== "resolved") return one.status;
  if (one.judge === undefined) return "no judge";
  if (one.judge.status === "used")
    return `→ ${one.judge.profile}${formatConfidence(one.judge.confidence)}`;
  return "agent";
};

/**
 * The routing session panel: one row per `spectre_routing` call, expanded into
 * the question the judge was asked and the model the resolver spent. The
 * question is reconstructed from the config the session runs on now, and the
 * expanded band says so.
 *
 * The keymap layer is created inside the component, so the panel's keys stop
 * existing the moment the host closes it, and `enabled` keeps them from firing
 * while the panel is up but the prompt owns the keyboard.
 */
export const routingBlade = (input: {
  readonly context: Plugin.Context;
  readonly panel: {
    readonly name: string;
    readonly sessionID: string;
    readonly width: number;
    readonly focused: boolean;
    readonly close: () => void;
  };
  readonly judgeView: () => JudgeView;
}): JSX.Element => {
  const context = input.context;
  const theme = context.theme;

  // One walk of the transcript per change, the same single-memo rule as the
  // tools panel: every row and the footer read this, so a message landing
  // mid-render cannot give two rows different totals.
  const report = createMemo(() => {
    const boundary = context.data.session.get(input.panel.sessionID)?.revert?.messageID;
    return routingCalls(context.data.session.message.list(input.panel.sessionID), boundary);
  });

  const [newestFirst, setNewestFirst] = createSignal(true);
  const [selected, setSelected] = createSignal(0);
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set());

  const rows = (): ReadonlyArray<RoutingCall> => {
    const calls = report();
    return newestFirst() ? [...calls].reverse() : calls;
  };

  const toggleExpanded = (id: string): void => {
    setExpanded((held) => {
      const next = new Set(held);
      if (next.has(id)) next.delete(id);
      else next.add(id);
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
        id: "spectre.routing.history.close",
        title: "Close routing panel",
        bind: "escape",
        run: () => input.panel.close(),
      },
      {
        id: "spectre.routing.history.sort",
        title: "Sort routing calls oldest or newest first",
        bind: "t",
        run: () => setNewestFirst((held) => !held),
      },
      {
        id: "spectre.routing.history.expand",
        title: "Expand selected routing call",
        bind: "enter",
        run: () => {
          const row = rows()[selected()];
          if (row !== undefined) toggleExpanded(row.id);
        },
      },
      { bind: "up", run: () => move(-1) },
      { bind: "down", run: () => move(1) },
    ],
  }));

  const rowLine = (one: RoutingCall, at: number): JSX.Element =>
    h(
      "box",
      {
        flexDirection: "row",
        gap: 1,
        width: "100%",
        minWidth: 0,
        onMouseUp: () => {
          setSelected(at);
          toggleExpanded(one.id);
        },
      },
      h("text", { fg: theme.text.base, flexShrink: 0 }, () => (selected() === at ? "▌" : " ")),
      h("text", { fg: theme.text.faint, wrapMode: "none", flexShrink: 0 }, () => clock(one.at)),
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
        one.task ?? one.namedProfile ?? "(no task)",
      ),
      h(
        "text",
        { fg: theme.text.base, wrapMode: "none", truncate: true, flexShrink: 0 },
        judgeCell(one),
      ),
      show(
        () => one.spent !== undefined,
        () =>
          h(
            "text",
            { fg: theme.text.muted, wrapMode: "none", truncate: true, flexShrink: 0 },
            one.spent?.ref ?? "",
          ),
      ),
    );

  /** One indented label-value line under a row. The value wraps; the label does not. */
  const detailLine = (band: DetailBand): JSX.Element =>
    h(
      "box",
      { flexDirection: "row", width: "100%", minWidth: 0 },
      h("text", { fg: theme.text.base, flexShrink: 0 }, "  "),
      h("text", { fg: theme.text.faint, flexShrink: 0, wrapMode: "none" }, band.label),
      h(
        "text",
        {
          fg: theme.text.muted,
          wrapMode: "word",
          truncate: true,
          flexGrow: 1,
          flexShrink: 1,
          minWidth: 0,
        },
        band.value,
      ),
    );

  /** The expanded view of one call, rendered from the bands `history` assembles. */
  const expandLine = (one: RoutingCall): JSX.Element =>
    h(
      "box",
      { flexDirection: "column", width: "100%", minWidth: 0 },
      ...expandBands(one, input.judgeView()).map(detailLine),
    );

  const sortHint = (): string => {
    const key = context.keymap.shortcuts("spectre.routing.history.sort")[0] ?? "t";
    return newestFirst() ? `sort oldest first (${key})` : `sort newest first (${key})`;
  };

  /** A full-width hairline: the panel's own width minus its side padding. */
  const rule = (): JSX.Element =>
    h(
      "text",
      { fg: theme.border?.base ?? theme.text.faint, wrapMode: "none" },
      "─".repeat(Math.max(0, input.panel.width - 2)),
    );

  /** One empty row. The panel has height to spare and the table reads better with air. */
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
          "Routing history",
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
      () => report().length > 0,
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
            },
            h("text", { fg: theme.text.faint, flexShrink: 0 }, " "),
            h("text", { fg: theme.text.faint, flexShrink: 0, wrapMode: "none" }, "time"),
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
              "task",
            ),
            h("text", { fg: theme.text.faint, wrapMode: "none", flexShrink: 0 }, "judge"),
            h("text", { fg: theme.text.faint, wrapMode: "none", flexShrink: 0 }, "spent"),
          ),
          rule(),
          air(),
          h(
            "box",
            { flexDirection: "column", width: "100%", flexGrow: 1, flexShrink: 1, minHeight: 0 },
            () => {
              const list = rows();
              return list.flatMap((one, at) =>
                expanded().has(one.id) ? [rowLine(one, at), expandLine(one)] : [rowLine(one, at)],
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
                const totals = routingTotals(report());
                return `Σ ${totals.calls} calls · ${totals.judged} judged · ${totals.agentChosen} agent-chosen`;
              },
            ),
          ),
        ),
    ),
    show(
      () => report().length === 0,
      () =>
        h(
          "box",
          { flexDirection: "row", width: "100%" },
          h("text", { fg: theme.text.muted, wrapMode: "none" }, "No routing calls yet."),
        ),
    ),
    air(),
    show(
      () => report().length > 0,
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
            "· ↑↓ select · ↵ expand",
          ),
          h(
            "text",
            { fg: theme.text.faint, wrapMode: "none", flexShrink: 0 },
            `· esc close (${context.keymap.shortcuts("spectre.routing.history.close")[0] ?? "escape"})`,
          ),
        ),
    ),
  );
};
