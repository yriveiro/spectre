import type { CollectedOutput } from "../nocturna";
import type { BoardContent, BoardSection, ChartDatum, KpiSection } from "./content";

type Collection = typeof CollectedOutput.Type;
type Tokens = Collection["totals"]["tokens"];

const count = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format;
const cost = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 6,
}).format;
const percent = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 2,
}).format;

const overview = ({ sessions, totals }: Collection): KpiSection => ({
  id: "overview",
  kind: "kpi",
  heading: "Batch totals",
  items: [
    { label: "Sessions collected", value: count(sessions.length) },
    { label: "Cost", value: cost(totals.cost) },
    { label: "Input tokens", value: count(totals.tokens.input) },
    { label: "Output tokens", value: count(totals.tokens.output) },
    { label: "Reasoning tokens", value: count(totals.tokens.reasoning) },
    { label: "Cache read tokens", value: count(totals.tokens.cacheRead) },
    { label: "Cache write tokens", value: count(totals.tokens.cacheWrite) },
    { label: "Tool calls", value: count(totals.toolCalls) },
    { label: "Tool errors", value: count(totals.toolErrors) },
    { label: "Retries", value: count(totals.retries) },
    { label: "Compactions", value: count(totals.compactions) },
  ],
});

const activeTokens = ({ input, output, reasoning }: Tokens): string =>
  count(input + output + reasoning);

const barChart = (
  id: string,
  heading: string,
  unit: string,
  data: ReadonlyArray<ChartDatum>,
): BoardSection[] => {
  const positive = data.filter(({ value }) => value > 0);
  return positive.length === 0
    ? []
    : [{ id, kind: "chart", heading, chart: "horizontal-bar", unit, data: positive }];
};

const toolSections = (tools: Collection["topTools"]): BoardSection[] => [
  ...barChart(
    "tool-calls",
    "Calls to top tools",
    "calls",
    tools.map(({ name, calls }) => ({ label: name, value: calls })),
  ),
  {
    id: "top-tools",
    kind: "table",
    heading: "Top tools",
    columns: ["Tool", "Calls", "Errors"],
    rows: tools.map(({ name, calls, errors }) => [name, count(calls), count(errors)]),
    note:
      tools.length === 0 ? "No tool calls recorded in this batch." : "Ranked by errors, then calls.",
  },
];

const skillSections = (skills: Collection["topSkills"]): BoardSection[] => [
  ...barChart(
    "skill-sessions",
    "Sessions using top skills",
    "sessions",
    skills.map(({ skill, sessions }) => ({ label: skill, value: sessions })),
  ),
  {
    id: "top-skills",
    kind: "table",
    heading: "Top skills",
    columns: [
      "Skill",
      "Sessions",
      "Invocations",
      "Load errors",
      "Attributed cost",
      "Attributed active tokens",
      "Unmeasured steps",
      "Post-load errors",
    ],
    rows: skills.map((skill) => [
      skill.skill,
      count(skill.sessions),
      count(skill.invocations),
      count(skill.loadErrors),
      cost(skill.attributedCost),
      activeTokens(skill.attributedTokens),
      count(skill.unmeasuredSteps),
      count(skill.postLoadErrors),
    ]),
    note:
      skills.length === 0
        ? "No skill telemetry recorded in this batch."
        : "Active tokens are input, output, and reasoning tokens.",
  },
];

const coverageSections = ({ skillCoverage, skillCoUse }: Collection): BoardSection[] => [
  {
    id: "skill-coverage",
    kind: "kpi",
    heading: "Skill telemetry coverage",
    items: [
      { label: "Live", value: count(skillCoverage.live) },
      { label: "Transcript", value: count(skillCoverage.transcript) },
      { label: "Hybrid", value: count(skillCoverage.hybrid) },
      { label: "None", value: count(skillCoverage.none) },
      { label: "Partial (across sources)", value: count(skillCoverage.partial) },
    ],
  },
  {
    id: "skill-co-use",
    kind: "table",
    heading: "Skill co-use",
    columns: ["Skill", "Paired skill", "Shared sessions", "Shared turns", "Jaccard overlap"],
    rows: skillCoUse.map(({ left, right, sessions, sameTurn, jaccard }) => [
      left,
      right,
      count(sessions),
      count(sameTurn),
      percent(jaccard),
    ]),
    note:
      skillCoUse.length === 0
        ? "No skill pairs recorded in this batch."
        : "Jaccard overlap is the share of sessions using either skill that used both.",
  },
];

const sessionSections = (sessions: Collection["sessions"]): BoardSection[] => [
  {
    id: "sessions",
    kind: "table",
    heading: "Sessions by anomaly score",
    columns: ["Session ID", "Title", "Agent", "Outcome", "Anomaly score", "Cost", "Active tokens"],
    rows: sessions.map((session) => [
      session.id,
      session.title ?? "—",
      session.agent ?? "—",
      session.outcome ?? "—",
      count(session.anomalyScore),
      cost(session.cost),
      activeTokens(session.tokens),
    ]),
    note:
      sessions.length === 0
        ? "No readable sessions were collected in this batch."
        : "Active tokens are input, output, and reasoning tokens.",
  },
  {
    id: "session-activity",
    kind: "table",
    heading: "Session activity",
    columns: [
      "Session ID",
      "User turns",
      "Assistant steps",
      "Retries",
      "Compactions",
      "Skills",
      "Skill coverage",
    ],
    rows: sessions.map((session) => [
      session.id,
      count(session.userTurns),
      count(session.assistantSteps),
      count(session.retries),
      count(session.compactions),
      session.skillsLoaded.join(", ") || "—",
      session.telemetryPartial
        ? `${session.telemetryCoverage} (partial)`
        : session.telemetryCoverage,
    ]),
    note: "For compacted sessions, activity can cover only the transcript after the latest compaction; cost and tokens cover the full session.",
  },
];

const decodePapercutDisplay = (value: string): string =>
  value.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");

const collectionCallouts = ({ unreadable, truncated, papercuts }: Collection): BoardSection[] => {
  const sections: BoardSection[] = [
    {
      id: "papercuts",
      kind: "callout",
      heading: "Papercuts",
      tone: papercuts.scanTruncated ? "risk" : "info",
      markdown:
        papercuts.status === "unavailable"
          ? "Papercut telemetry is unavailable."
          : `${count(papercuts.openGroups)} open groups; ${count(papercuts.newReportsInWindow)} new reports in the window.${papercuts.scanTruncated ? " The papercut scan was truncated." : ""}`,
    },
  ];
  if (papercuts.status === "ok" && papercuts.topGroups.length > 0) {
    sections.push({
      id: "top-papercuts",
      kind: "table",
      heading: "Top open papercut groups",
      columns: ["Group ID", "Target type", "Target", "Occurrences", "Projects", "Reopened"],
      rows: papercuts.topGroups.map((group) => [
        group.groupId,
        group.targetKind,
        decodePapercutDisplay(group.target),
        count(group.occurrences),
        count(group.projects),
        group.reopened ? "Yes" : "No",
      ]),
    });
  }
  if (unreadable.length > 0) {
    sections.push({
      id: "unreadable-sessions",
      kind: "callout",
      heading: "Unreadable sessions",
      tone: "risk",
      markdown: `Nocturna could not read ${count(unreadable.length)} session histories. The batch totals exclude those sessions.`,
    });
  }
  if (truncated) {
    sections.push({
      id: "truncated-scan",
      kind: "callout",
      heading: "Truncated session scan",
      tone: "risk",
      markdown:
        "The scan reached its row limit before covering the full window. Window counts may be incomplete.",
    });
  }
  return sections;
};

export const nocturnaBoard = (collection: Collection): BoardContent => ({
  kind: "board",
  title: `Nocturna telemetry — ${count(collection.windowDays)} ${collection.windowDays === 1 ? "day" : "days"}`,
  summary: `${count(collection.scannedInWindow)} sessions scanned in the window; ${count(collection.skippedAnalyzed)} previously analyzed sessions skipped; ${count(collection.remainingUnanalyzed)} pending sessions not selected for this batch. Totals and rankings cover the collected batch, not the entire window.`,
  sections: [
    overview(collection),
    ...toolSections(collection.topTools),
    ...skillSections(collection.topSkills),
    ...coverageSections(collection),
    ...sessionSections(collection.sessions),
    ...collectionCallouts(collection),
  ],
});
