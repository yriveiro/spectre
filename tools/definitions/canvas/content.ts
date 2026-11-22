import { Schema } from "effect";

/**
 * The public shape of `tools.spectre.canvas`, and the only place the input and
 * output unions are written. The declaration, the dispatch and every composer
 * read these schemas, so a field an outcome cannot carry is not on its type.
 *
 * Everything here stays inside the tool boundary subset measured in
 * `tools/FOR_AGENTS.md`: `Struct`, `Union`, `Literals`, `String`, `Number`,
 * `Array`, `optional`. A non-empty title or body is checked in `execute`, not
 * by a schema refinement, because the schema describes the JSON shape and does
 * not enforce it.
 */

const PullRequestSubjectSchema = Schema.Struct({
  kind: Schema.Literals(["pull-request"]),
  number: Schema.Number,
  repository: Schema.String,
  url: Schema.String,
  title: Schema.String,
  author: Schema.String,
  state: Schema.Literals(["open", "closed", "merged"]),
  headSha: Schema.String,
  baseRef: Schema.String,
  headRef: Schema.String,
  additions: Schema.Number,
  deletions: Schema.Number,
  changedFiles: Schema.Number,
  isDraft: Schema.Boolean,
  body: Schema.String,
});
export type PullRequestSubject = Schema.Schema.Type<typeof PullRequestSubjectSchema>;

const LocalDiffSubjectSchema = Schema.Struct({
  kind: Schema.Literals(["local-diff"]),
  base: Schema.String,
  head: Schema.String,
  headSha: Schema.String,
});
export type LocalDiffSubject = Schema.Schema.Type<typeof LocalDiffSubjectSchema>;

export const Subject = Schema.Union([PullRequestSubjectSchema, LocalDiffSubjectSchema]);
export type Subject = Schema.Schema.Type<typeof Subject>;

export const Totals = Schema.Struct({
  files: Schema.Number,
  additions: Schema.Number,
  deletions: Schema.Number,
});
export type Totals = Schema.Schema.Type<typeof Totals>;

export const Cross = Schema.Union([
  Schema.Struct({ kind: Schema.Literals(["matched"]), parsed: Totals, reported: Totals }),
  Schema.Struct({
    kind: Schema.Literals(["mismatched"]),
    parsed: Totals,
    reported: Totals,
    why: Schema.String,
  }),
  Schema.Struct({ kind: Schema.Literals(["no-oracle"]), parsed: Totals, why: Schema.String }),
]);
export type Cross = Schema.Schema.Type<typeof Cross>;

export const FileRow = Schema.Union([
  Schema.Struct({
    status: Schema.Literals(["read"]),
    index: Schema.Number,
    path: Schema.String,
    additions: Schema.Number,
    deletions: Schema.Number,
    rows: Schema.String,
  }),
  Schema.Struct({
    status: Schema.Literals(["unreadable"]),
    index: Schema.Number,
    path: Schema.String,
    reason: Schema.String,
    rows: Schema.String,
  }),
]);
export type FileRow = Schema.Schema.Type<typeof FileRow>;

export const Group = Schema.Struct({
  heading: Schema.String,
  note: Schema.optional(Schema.String),
  paths: Schema.Array(Schema.String),
});
export type Group = Schema.Schema.Type<typeof Group>;

export const Location = Schema.Struct({
  path: Schema.String,
  side: Schema.Literals(["base", "head"]),
  line: Schema.Number,
});
export type Location = Schema.Schema.Type<typeof Location>;

export const Point = Schema.Union([
  Schema.Struct({
    kind: Schema.Literals(["requirement"]),
    text: Schema.String,
    source: Schema.String,
    at: Location,
    note: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literals(["change"]),
    text: Schema.String,
    at: Location,
    note: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literals(["question"]),
    text: Schema.String,
    at: Location,
    note: Schema.optional(Schema.String),
  }),
]);
export type Point = Schema.Schema.Type<typeof Point>;

export const Review = Schema.Struct({
  summary: Schema.String,
  groups: Schema.Array(Group),
  points: Schema.Array(Point),
  unknowns: Schema.optional(Schema.Array(Schema.String)),
});
export type Review = Schema.Schema.Type<typeof Review>;

export const PageContent = Schema.Struct({
  kind: Schema.Literals(["page"]),
  title: Schema.String,
  html: Schema.String,
});
export type PageContent = Schema.Schema.Type<typeof PageContent>;

export const ReportContent = Schema.Struct({
  kind: Schema.Literals(["report"]),
  title: Schema.String,
  markdown: Schema.String,
});
export type ReportContent = Schema.Schema.Type<typeof ReportContent>;

export const DiagramContent = Schema.Struct({
  kind: Schema.Literals(["diagram"]),
  title: Schema.String,
  takeaway: Schema.String,
  mermaid: Schema.String,
  caption: Schema.optional(Schema.String),
});
export type DiagramContent = Schema.Schema.Type<typeof DiagramContent>;

export const PrContent = Schema.Struct({
  kind: Schema.Literals(["pr"]),
  token: Schema.String,
  review: Review,
});
export type PrContent = Schema.Schema.Type<typeof PrContent>;

export const Citation = Schema.Struct({
  path: Schema.String,
  line: Schema.optional(Schema.Number),
  symbol: Schema.optional(Schema.String),
});
export type Citation = Schema.Schema.Type<typeof Citation>;

export const KpiCard = Schema.Struct({
  label: Schema.String,
  value: Schema.String,
  delta: Schema.optional(Schema.String),
  tone: Schema.optional(Schema.Literals(["neutral", "good", "warn", "bad"])),
});
export type KpiCard = Schema.Schema.Type<typeof KpiCard>;

export const ChartDatum = Schema.Struct({
  label: Schema.String,
  value: Schema.Number,
});
export type ChartDatum = Schema.Schema.Type<typeof ChartDatum>;

export const KpiSection = Schema.Struct({
  id: Schema.optional(Schema.String),
  kind: Schema.Literals(["kpi"]),
  heading: Schema.String,
  items: Schema.Array(KpiCard),
});
export type KpiSection = Schema.Schema.Type<typeof KpiSection>;

export const ChartSection = Schema.Struct({
  id: Schema.optional(Schema.String),
  kind: Schema.Literals(["chart"]),
  heading: Schema.String,
  chart: Schema.Literals(["bar", "horizontal-bar", "line"]),
  unit: Schema.optional(Schema.String),
  note: Schema.optional(Schema.String),
  data: Schema.Array(ChartDatum),
});
export type ChartSection = Schema.Schema.Type<typeof ChartSection>;

export const TableSection = Schema.Struct({
  id: Schema.optional(Schema.String),
  kind: Schema.Literals(["table"]),
  heading: Schema.String,
  note: Schema.optional(Schema.String),
  columns: Schema.Array(Schema.String),
  rows: Schema.Array(Schema.Array(Schema.String)),
});
export type TableSection = Schema.Schema.Type<typeof TableSection>;

export const DiagramSection = Schema.Struct({
  id: Schema.optional(Schema.String),
  kind: Schema.Literals(["diagram"]),
  heading: Schema.String,
  mermaid: Schema.String,
  caption: Schema.optional(Schema.String),
});
export type DiagramSection = Schema.Schema.Type<typeof DiagramSection>;

export const CodeSection = Schema.Struct({
  id: Schema.optional(Schema.String),
  kind: Schema.Literals(["code"]),
  heading: Schema.String,
  language: Schema.optional(Schema.String),
  code: Schema.String,
  at: Schema.optional(Citation),
});
export type CodeSection = Schema.Schema.Type<typeof CodeSection>;

export const CalloutSection = Schema.Struct({
  id: Schema.optional(Schema.String),
  kind: Schema.Literals(["callout"]),
  heading: Schema.String,
  tone: Schema.optional(Schema.Literals(["info", "decision", "risk", "question"])),
  markdown: Schema.String,
  at: Schema.optional(Citation),
});
export type CalloutSection = Schema.Schema.Type<typeof CalloutSection>;

export const EvidenceSection = Schema.Struct({
  id: Schema.optional(Schema.String),
  kind: Schema.Literals(["evidence"]),
  heading: Schema.String,
  source: Schema.Literals(["brain", "goal", "ripwire-hotspots", "ripwire-impact", "ripwire-delta"]),
  target: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.Number),
  note: Schema.optional(Schema.String),
});
export type EvidenceSection = Schema.Schema.Type<typeof EvidenceSection>;

export const BoardSection = Schema.Union([
  KpiSection,
  ChartSection,
  TableSection,
  DiagramSection,
  CodeSection,
  CalloutSection,
  EvidenceSection,
]);
export type BoardSection = Schema.Schema.Type<typeof BoardSection>;

export const BoardContent = Schema.Struct({
  kind: Schema.Literals(["board"]),
  title: Schema.String,
  summary: Schema.optional(Schema.String),
  sections: Schema.Array(BoardSection),
});
export type BoardContent = Schema.Schema.Type<typeof BoardContent>;

export const BrainContent = Schema.Struct({
  kind: Schema.Literals(["brain"]),
  focus: Schema.optional(Schema.String),
});
export type BrainContent = Schema.Schema.Type<typeof BrainContent>;

export const Content = Schema.Union([
  PageContent,
  ReportContent,
  DiagramContent,
  PrContent,
  BoardContent,
  BrainContent,
]);
export type Content = Schema.Schema.Type<typeof Content>;

export const DiffInput = Schema.Struct({
  action: Schema.Literals(["diff"]),
  pr: Schema.optional(Schema.Number),
  url: Schema.optional(Schema.String),
  base: Schema.optional(Schema.String),
  head: Schema.optional(Schema.String),
});
export type DiffInput = Schema.Schema.Type<typeof DiffInput>;

export const PublishInput = Schema.Struct({
  action: Schema.Literals(["publish"]),
  content: Content,
});
export type PublishInput = Schema.Schema.Type<typeof PublishInput>;

export const UpdateInput = Schema.Struct({
  action: Schema.Literals(["update"]),
  id: Schema.String,
  content: Content,
});
export type UpdateInput = Schema.Schema.Type<typeof UpdateInput>;

export const PatchOp = Schema.Union([
  Schema.Struct({
    op: Schema.Literals(["set-title"]),
    title: Schema.String,
  }),
  Schema.Struct({
    op: Schema.Literals(["set-summary"]),
    summary: Schema.String,
  }),
  Schema.Struct({
    op: Schema.Literals(["replace-section"]),
    heading: Schema.String,
    markdown: Schema.String,
  }),
  Schema.Struct({
    op: Schema.Literals(["append-markdown"]),
    markdown: Schema.String,
  }),
  Schema.Struct({
    op: Schema.Literals(["set-diagram"]),
    mermaid: Schema.String,
    takeaway: Schema.optional(Schema.String),
    caption: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    op: Schema.Literals(["upsert-point"]),
    index: Schema.optional(Schema.Number),
    point: Point,
  }),
  Schema.Struct({
    op: Schema.Literals(["remove-point"]),
    index: Schema.Number,
  }),
  Schema.Struct({
    op: Schema.Literals(["upsert-group"]),
    group: Group,
  }),
  Schema.Struct({
    op: Schema.Literals(["upsert-board-section"]),
    section: BoardSection,
  }),
  Schema.Struct({
    op: Schema.Literals(["remove-board-section"]),
    target: Schema.String,
  }),
]);
export type PatchOp = Schema.Schema.Type<typeof PatchOp>;

export const PatchInput = Schema.Struct({
  action: Schema.Literals(["patch"]),
  id: Schema.String,
  ops: Schema.Array(PatchOp),
});
export type PatchInput = Schema.Schema.Type<typeof PatchInput>;

export const Input = Schema.Union([DiffInput, PublishInput, UpdateInput, PatchInput]);
export type Input = Schema.Schema.Type<typeof Input>;

export const Published = Schema.Struct({
  status: Schema.Literals(["published"]),
  id: Schema.String,
  url: Schema.String,
  provider: Schema.String,
  title: Schema.String,
  bytes: Schema.Number,
  warnings: Schema.Array(Schema.String),
});
export type Published = Schema.Schema.Type<typeof Published>;

export const ReadOutput = Schema.Struct({
  status: Schema.Literals(["read"]),
  token: Schema.String,
  subject: Subject,
  totals: Totals,
  cross: Cross,
  files: Schema.Array(FileRow),
  warnings: Schema.Array(Schema.String),
});
export type ReadOutput = Schema.Schema.Type<typeof ReadOutput>;

export const Refused = Schema.Struct({
  status: Schema.Literals(["refused"]),
  problem: Schema.String,
});
export type Refused = Schema.Schema.Type<typeof Refused>;

export const Output = Schema.Union([Published, ReadOutput, Refused]);
export type Output = Schema.Schema.Type<typeof Output>;

/**
 * A composed page before it reaches the artifact tools. `title` is part of the
 * result because a PR page takes its title from the pull request, not from a
 * field the model could disagree with.
 */
export type Composed =
  | {
      readonly ok: true;
      readonly title: string;
      readonly files: Readonly<Record<string, string>>;
      readonly warnings: ReadonlyArray<string>;
    }
  | { readonly ok: false; readonly problem: string };

export const refused = (problem: string): Refused => ({ status: "refused", problem });
