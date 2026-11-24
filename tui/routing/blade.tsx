import type { Plugin } from "@opencode/plugin/tui";
import { TextAttributes } from "@opentui/core";
import type { JSX } from "@opentui/solid";
import { createMemo, createSignal } from "solid-js";
import { clampIndex, h, show, wrapLines } from "../render.ts";
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

/** The detail band's label column: `crosscheck` is the longest label a call
 * carries, so every value starts at the same column. */
const LABEL_COLUMN = 10;

/** The detail band's line cap. A constant, so the band keeps its shape
 * whatever the call's bands hold, and the rows above yield the space. */
const DETAIL_LINES = 8;

/**
 * The selected call's bands, folded to `width` columns with every value
 * starting at the label column, at most `maxLines` lines, the last visible
 * line ending in an ellipsis when the fold cut anything. Exported for the
 * layout test, which asserts the band as pure data the same way the
 * subagents blade's fold is asserted.
 */
export const foldBands = (
  bands: ReadonlyArray<DetailBand>,
  width: number,
  maxLines: number,
): ReadonlyArray<string> => {
  const label = (one: DetailBand): string => one.label.padEnd(LABEL_COLUMN);
  const flat = bands.flatMap((one) => {
    const folded = wrapLines(one.value, Math.max(1, width - LABEL_COLUMN), maxLines);
    return [
      `${label(one)}${folded[0] ?? ""}`,
      ...folded.slice(1).map((line) => `${" ".repeat(LABEL_COLUMN)}${line}`),
    ];
  });
  if (flat.length <= maxLines) return flat;
  const cut = flat.slice(0, maxLines);
  const last = cut[maxLines - 1] ?? "";
  return [...cut.slice(0, -1), `${last.slice(0, Math.max(0, width - 1))}…`];
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
 * The routing session panel: one row per `spectre_routing` call, with a
 * detail band below the totals that reads the selected row — the question
 * the judge was asked and the model the resolver spent. The
 * question is reconstructed from the config the session runs on now, and
 * the band says so.
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

  const rows = (): ReadonlyArray<RoutingCall> => {
    const calls = report();
    return newestFirst() ? [...calls].reverse() : calls;
  };

  /** The clamped selection index. A revert can shorten the list under a
   * selection, and the marker, the bold row and the detail band must all
   * agree on which row is selected, so every read goes through this clamp. */
  const selectedAt = (): number => clampIndex(selected(), rows().length);

  const move = (delta: number): void => {
    const count = rows().length;
    if (count === 0) return;
    setSelected((at) => clampIndex(at + delta, count));
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
        onMouseUp: () => setSelected(at),
      },
      h("text", { fg: theme.text.base, flexShrink: 0 }, () => (selectedAt() === at ? "▌" : " ")),
      h("text", { fg: theme.text.faint, wrapMode: "none", flexShrink: 0 }, () => clock(one.at)),
      h(
        "text",
        {
          fg: selectedAt() === at ? theme.text.base : theme.text.muted,
          attributes: selectedAt() === at ? TextAttributes.BOLD : undefined,
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

  /** The selected call's detail band, below the totals: the bands `history`
   * assembles, folded to the width and capped, so the band keeps a constant
   * shape whatever the call holds and the rows above yield the space. */
  const detailBand = (one: RoutingCall): JSX.Element =>
    h(
      "box",
      { flexDirection: "column", width: "100%", minWidth: 0, flexShrink: 0 },
      air(),
      rule(),
      air(),
      ...foldBands(expandBands(one, input.judgeView()), Math.max(1, input.panel.width - 4), DETAIL_LINES).map(
        (line) => h("text", { fg: theme.text.muted, wrapMode: "none", flexShrink: 0 }, `  ${line}`),
      ),
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
          // The rows are the flexible region: they yield to the detail band
          // below and clip their own overflow, so a list longer than fits
          // loses its tail and nothing else moves.
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
            () => rows().map((one, at) => rowLine(one, at)),
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
          // The detail band: the selected call's question and spend, the same
          // selection-driven section the subagents blade holds under its run
          // table. The function child keeps it reading the selection as it
          // moves.
          h(
            "box",
            { flexDirection: "column", width: "100%", minWidth: 0, flexShrink: 0 },
            () => {
              const one = rows()[selectedAt()];
              return one === undefined ? null : detailBand(one);
            },
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
            "· ↑↓ select",
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
