import type { Plugin } from "@opencode/plugin/effect";
import type { Tool } from "@opencode/schema/tool";
import { Effect, Schema } from "effect";
import { CONTRACT } from "./contract";
import { recordsOf, type UsageRecord } from "./measure";

/**
 * The report reads the usage record and names the sessions that skipped a verb.
 * It is `codemode: true` because it is a rare read, not a native tool, and it
 * scopes to the project by reading that project's one storage key.
 */

export const ReportInput = Schema.Struct({});

const Finding = Schema.Struct({
  session: Schema.String,
  parent: Schema.optional(Schema.String),
  count: Schema.Number,
  missing: Schema.String,
});

export const ReportOutput = Schema.Struct({
  tool: Schema.Literals(["spectre_ripwire_report"]),
  project: Schema.String,
  sessions: Schema.Number,
  findings: Schema.Array(Finding),
  summary: Schema.String,
});

type Finding = typeof Finding.Type;

const DELTA = "ripwire . --quality-delta";
const LOOKUP = "ripwire . --for=<task>";
const FANOUT = "ripwire . --pack-task=<task> --partition=<n>";

const deltaFresh = (record: UsageRecord): boolean =>
  record.measured.delta !== undefined && record.measured.delta >= record.edits;

const named = (record: UsageRecord, count: number, missing: string): Finding => ({
  session: record.session,
  ...(record.parent === undefined ? {} : { parent: record.parent }),
  count,
  missing,
});

/** One finding per session and missing verb, in the order the plan names them. */
const findingsOf = (records: ReadonlyArray<UsageRecord>): ReadonlyArray<Finding> =>
  records.flatMap((record) => [
    ...(record.edits > 0 && !deltaFresh(record) ? [named(record, record.edits, DELTA)] : []),
    ...(record.reads > 0 && record.lookups === 0 ? [named(record, record.reads, LOOKUP)] : []),
    ...(record.subagents > 0 && record.packed === 0 ? [named(record, record.subagents, FANOUT)] : []),
  ]);

const describe = (
  project: string,
  records: ReadonlyArray<UsageRecord>,
  findings: ReadonlyArray<Finding>,
): string => {
  if (records.length === 0) return `No session in ${project} has been recorded yet.`;
  if (findings.length === 0)
    return `No session in ${project} skipped a ripwire verb across ${records.length} recorded.`;
  const rows = findings.map((one) => `- ${one.session} (${one.count}): \`${one.missing}\` never ran`);
  return `${findings.length} findings across ${records.length} sessions in ${project}:\n${rows.join("\n")}`;
};

export const report = (ctx: Plugin.Context): Tool.Info<typeof ReportInput, typeof ReportOutput> => ({
  name: "ripwire_report",
  description: CONTRACT.report,
  input: ReportInput,
  output: ReportOutput,
  options: { namespace: "spectre", codemode: true },
  execute: () =>
    Effect.gen(function* () {
      const project = ctx.location.project.id;
      const records = yield* recordsOf(ctx.storage, project);
      const findings = findingsOf(records);
      const summary = describe(project, records, findings);
      return {
        output: {
          tool: "spectre_ripwire_report" as const,
          project,
          sessions: records.length,
          findings,
          summary,
        },
        content: summary,
      };
    }),
});
