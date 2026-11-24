import type { Plugin } from "@opencode/plugin/tui";
import type { JSX } from "@opentui/solid";
import { createMemo } from "solid-js";
import { blade } from "../blade.tsx";
import type { Column } from "../blade-layout.ts";
import {
  expandBands,
  formatConfidence,
  type JudgeView,
  type RoutingCall,
  routingCalls,
  routingTotals,
} from "./history.ts";

/** The detail band's label column: `crosscheck` is the longest label a call
 * carries, so every value starts at the same column. */
const LABEL_COLUMN = 10;

/** The detail band's line cap. A constant, so the band keeps its shape
 * whatever the call's bands hold, and the rows above yield the space. */
const DETAIL_LINES = 8;

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
 * The routing session panel: one row per `spectre_routing` call, and below
 * the totals a detail band reading the selected row — the question the
 * judge was asked and the model the resolver spent. The question is
 * reconstructed from the config the session runs on now, and the band says
 * so. expandBands orders the transcript's own record before the
 * reconstruction, because a band capped to a constant shape must cut the
 * reconstruction before it cuts the record.
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

  // One walk of the transcript per change, the same single-memo rule as the
  // tools panel: every row and the footer read this, so a message landing
  // mid-render cannot give two rows different totals.
  const report = createMemo(() => {
    const boundary = context.data.session.get(input.panel.sessionID)?.revert?.messageID;
    return routingCalls(context.data.session.message.list(input.panel.sessionID), boundary);
  });

  // Newest first, fixed: the panel's subject is the most recent routing
  // decisions, so the transcript order reverses and no state reorders it.
  const rows = (): ReadonlyArray<RoutingCall> => [...report()].reverse();

  const columns: ReadonlyArray<Column<RoutingCall>> = [
    { header: "time", width: 8, cell: (one) => clock(one.at) },
    { header: "task", cell: (one) => one.task ?? one.namedProfile ?? "(no task)" },
    { header: "judge", width: { min: 4, max: 24 }, cell: judgeCell },
    // Capped below the longest ref: the aligned column may clip one
    // character, because the detail band carries the whole ref anyway.
    {
      header: "spent",
      width: { min: 4, max: 20 },
      tone: "muted",
      cell: (one) => one.spent?.ref ?? "",
    },
  ];

  return blade<RoutingCall>({
    context,
    panel: input.panel,
    id: "spectre.routing.history",
    title: "Routing history",
    subtitle: () => context.data.session.get(input.panel.sessionID)?.title ?? input.panel.sessionID,
    empty: () => "No routing calls yet.",
    sections: () => [{ rows: rows() }],
    columns,
    summary: () => {
      const totals = routingTotals(report());
      return [
        {
          text: `Σ ${totals.calls} calls · ${totals.judged} judged · ${totals.agentChosen} agent-chosen`,
        },
      ];
    },
    detail: {
      bands: (one) => expandBands(one, input.judgeView()),
      cap: DETAIL_LINES,
      labelColumn: LABEL_COLUMN,
      indent: 2,
    },
  });
};
