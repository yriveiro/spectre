import type { Plugin, Tool } from "@opencode/plugin/effect";
import { Effect, Schema } from "effect";
import { CONTRACT, INSTALL } from "./contract";
import { recordCheck, recordsOf, type UsageRecord } from "./measure";
import type { Health } from "./policy";
import { probe } from "./probe";
import { rootOf } from "./root";
import { scope } from "./run";
import { codePath } from "./signals";
import { memoryOf, remember } from "./state";

export const RipwireInput = Schema.Struct({
  action: Schema.optional(Schema.Literals(["check", "report"])).annotate({
    description:
      "Defaults to `check` (run --quality-delta and --affected on edited code). `report` audits session usage records.",
  }),
  paths: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Optional project-relative code paths to check instead of session memory.",
  }),
});

const Finding = Schema.Struct({
  session: Schema.String,
  parent: Schema.optional(Schema.String),
  count: Schema.Number,
  missing: Schema.String,
});

const CheckResult = Schema.Struct({
  action: Schema.Literals(["check"]),
  status: Schema.Literals(["ok", "gating", "nothing-edited", "absent", "refused"]),
  sha: Schema.String,
  gating: Schema.Number,
  regressions: Schema.Number,
  newSymbols: Schema.Number,
  newSymbolRows: Schema.Array(Schema.String),
  testsToRun: Schema.Array(Schema.String),
  paths: Schema.Array(Schema.String),
  commands: Schema.Array(Schema.String),
  summary: Schema.String,
});

const ReportResult = Schema.Struct({
  action: Schema.Literals(["report"]),
  status: Schema.Literals(["reported"]),
  project: Schema.String,
  sessions: Schema.Number,
  findings: Schema.Array(Finding),
  summary: Schema.String,
});

export const RipwireOutput = Schema.Union([CheckResult, ReportResult]);

type Finding = typeof Finding.Type;
type CheckOutput = typeof CheckResult.Type;

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

const findingsOf = (records: ReadonlyArray<UsageRecord>): Array<Finding> =>
  records.flatMap((record) => [
    ...(record.edits > 0 && !deltaFresh(record) ? [named(record, record.edits, DELTA)] : []),
    ...(record.reads > 0 && record.lookups === 0 ? [named(record, record.reads, LOOKUP)] : []),
    ...(record.subagents >= 2 && record.packed === 0
      ? [named(record, record.subagents, FANOUT)]
      : []),
  ]);

const describeReport = (
  project: string,
  records: ReadonlyArray<UsageRecord>,
  findings: ReadonlyArray<Finding>,
): string => {
  if (records.length === 0) return `No session in ${project} has been recorded yet.`;
  if (findings.length === 0)
    return `No session in ${project} skipped a ripwire verb across ${records.length} recorded.`;
  const rows = findings.map(
    (one) => `- ${one.session} (${one.count}): \`${one.missing}\` never ran`,
  );
  return `${findings.length} findings across ${records.length} sessions in ${project}:\n${rows.join("\n")}`;
};

const runReport = (ctx: Plugin.Context) =>
  Effect.gen(function* () {
    const project = ctx.location.project.id;
    const records = yield* recordsOf(ctx.storage, project);
    const findings = findingsOf(records);
    const summary = describeReport(project, records, findings);
    return {
      output: {
        action: "report" as const,
        status: "reported" as const,
        project,
        sessions: records.length,
        findings,
        summary,
      },
      content: summary,
    };
  });

interface SpawnOutcome {
  readonly ok: boolean;
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

const spawnRipwire = async (
  args: readonly string[],
  cwd: string,
  timeoutMs: number = 20_000,
): Promise<SpawnOutcome> => {
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const proc = Bun.spawn([...args], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      signal,
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { ok: !signal.aborted, code, stdout, stderr, timedOut: signal.aborted };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return { ok: false, code: -1, stdout: "", stderr: timedOut ? "" : String(error), timedOut };
  }
};

const parseDelta = (xml: string, code: number) => {
  const header = /<quality-delta\b([^>]*)>/.exec(xml)?.[1] ?? "";
  const attr = (name: string): string | undefined =>
    new RegExp(`\\b${name}="([^"]*)"`).exec(header)?.[1];
  const newSymbolRows = [
    ...xml.matchAll(/<r\b[^>]*\borigin="new-symbol"[^>]*?(?:\/>|>[\s\S]*?<\/r>)/g),
  ].map((match) => match[0].trim());
  const gatingRaw = attr("gating");
  const gating = gatingRaw !== undefined ? Number(gatingRaw) : code === 2 ? 1 : 0;
  const regressions = Number(attr("regressions") ?? "0");
  const newSymbolsRaw = attr("new-symbol") ?? attr("new_symbol");
  const newSymbols = newSymbolsRaw !== undefined ? Number(newSymbolsRaw) : newSymbolRows.length;
  const sha = attr("at") ?? "";
  return { sha, gating, regressions, newSymbols, newSymbolRows };
};

const parseAffected = (xml: string): Array<string> => {
  const found = new Set<string>();
  for (const match of xml.matchAll(/<(?:test|t)\b[^>]*\bp="([^"]+)"/g)) {
    const path = match[1]?.replaceAll("&#44;", ",").trim();
    if (path !== undefined && path !== "") found.add(path);
  }
  for (const match of xml.matchAll(/<g\b[^>]*\bp="([^"]+)"/g)) {
    const raw = match[1] ?? "";
    for (const part of raw.split(",")) {
      const path = part.replaceAll("&#44;", ",").trim();
      if (path !== "") found.add(path);
    }
  }
  return [...found].sort();
};

const emptyCheck = (
  status: CheckOutput["status"],
  summary: string,
  paths: Array<string> = [],
  commands: Array<string> = [],
): CheckOutput => ({
  action: "check",
  status,
  sha: "",
  gating: 0,
  regressions: 0,
  newSymbols: 0,
  newSymbolRows: [],
  testsToRun: [],
  paths,
  commands,
  summary,
});

const failureMessage = (label: string, outcome: SpawnOutcome): string => {
  if (outcome.timedOut) return `${label} did not answer within 20000ms.`;
  const detail = outcome.stderr.trim();
  return detail === "" ? `${label} exited ${outcome.code}.` : detail;
};

type SelectedPaths =
  | { readonly kind: "refused"; readonly summary: string }
  | { readonly kind: "empty" }
  | { readonly kind: "ready"; readonly paths: Array<string> };

const unquotePorcelainPath = (raw: string): string =>
  raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1).replace(/\\(["\\])/g, "$1") : raw;

const parsePorcelainLine = (line: string): string | undefined => {
  const clean = line.endsWith("\r") ? line.slice(0, -1) : line;
  if (clean.length < 4 || clean[2] !== " ") return undefined;
  const status = clean.slice(0, 2);
  if (status === "!!" || status[1] === "D" || status === "D ") return undefined;
  const rest = clean.slice(3);
  const arrow = status.includes("R") || status.includes("C") ? rest.lastIndexOf(" -> ") : -1;
  const target = arrow >= 0 ? rest.slice(arrow + 4) : rest;
  return unquotePorcelainPath(target);
};

const parsePorcelainCodePaths = (stdout: string, root: string): Array<string> => {
  const found = new Set<string>();
  for (const line of stdout.split("\n")) {
    const path = parsePorcelainLine(line);
    if (path !== undefined && codePath(path) && scope(root, path) !== undefined) {
      found.add(path);
    }
  }
  return [...found].sort();
};

const gitWorkingTreeCodePaths = async (root: string): Promise<Array<string>> => {
  const outcome = await spawnRipwire(["git", "status", "--porcelain", "-uall"], root);
  if (!outcome.ok || outcome.code !== 0) return [];
  return parsePorcelainCodePaths(outcome.stdout, root);
};

const selectTargetPaths = (
  root: string,
  inputPaths: ReadonlyArray<string> | undefined,
  editedCode: ReadonlySet<string>,
): SelectedPaths => {
  if (inputPaths !== undefined && inputPaths.length > 0) {
    const escaped = inputPaths.find((candidate) => scope(root, candidate) === undefined);
    if (escaped !== undefined) {
      return {
        kind: "refused",
        summary: `${escaped} is outside ${root}, so no code index was read.`,
      };
    }
    const paths = [...new Set(inputPaths.filter((candidate) => codePath(candidate)))].sort();
    return paths.length === 0 ? { kind: "empty" } : { kind: "ready", paths };
  }
  const paths = [...editedCode].sort();
  return paths.length === 0 ? { kind: "empty" } : { kind: "ready", paths };
};

const resolveTargetPaths = async (
  root: string,
  inputPaths: ReadonlyArray<string> | undefined,
  editedCode: ReadonlySet<string>,
): Promise<SelectedPaths> => {
  const selected = selectTargetPaths(root, inputPaths, editedCode);
  if (selected.kind !== "empty" || inputPaths !== undefined) return selected;
  const gitPaths = await gitWorkingTreeCodePaths(root);
  return gitPaths.length === 0 ? { kind: "empty" } : { kind: "ready", paths: gitPaths };
};

const buildCheckOutput = (
  delta: SpawnOutcome,
  affectedXml: string,
  paths: Array<string>,
  commands: Array<string>,
): CheckOutput => {
  const parsed = parseDelta(delta.stdout, delta.code);
  const testsToRun = parseAffected(affectedXml);
  const status = delta.code === 2 || parsed.gating > 0 ? ("gating" as const) : ("ok" as const);
  const at = parsed.sha === "" ? "" : ` at=${parsed.sha}`;
  const tests = testsToRun.length === 0 ? "none" : testsToRun.join(", ");
  const summary = `ripwire check (${status}${at}): gating=${parsed.gating} regressions=${parsed.regressions} new-symbol=${parsed.newSymbols}; tests to run: ${tests}`;
  return {
    action: "check",
    status,
    sha: parsed.sha,
    gating: parsed.gating,
    regressions: parsed.regressions,
    newSymbols: parsed.newSymbols,
    newSymbolRows: parsed.newSymbolRows,
    testsToRun,
    paths,
    commands,
    summary,
  };
};

const executeCheckSpawns = async (
  binary: string,
  root: string,
  targetPaths: Array<string>,
): Promise<{ readonly ok: boolean; readonly output: CheckOutput }> => {
  const deltaArgs = [binary, root, "--quality-delta", "--legend=compact"];
  const affectedArgs = [binary, root, `--affected=${targetPaths.join(",")}`, "--legend=compact"];
  const commands = [deltaArgs.join(" "), affectedArgs.join(" ")];
  const [delta, affected] = await Promise.all([
    spawnRipwire(deltaArgs, root),
    spawnRipwire(affectedArgs, root),
  ]);
  if (!delta.ok || (delta.code !== 0 && delta.code !== 2)) {
    const summary = failureMessage("ripwire --quality-delta", delta);
    return { ok: false, output: emptyCheck("refused", summary, targetPaths, commands) };
  }
  if (!affected.ok || affected.code !== 0) {
    const summary = failureMessage("ripwire --affected", affected);
    return { ok: false, output: emptyCheck("refused", summary, targetPaths, commands) };
  }
  return { ok: true, output: buildCheckOutput(delta, affected.stdout, targetPaths, commands) };
};

const coversEditedPaths = (
  root: string,
  targetPaths: ReadonlyArray<string>,
  editedCode: ReadonlySet<string>,
): boolean => {
  const direct = new Set(targetPaths);
  const resolved = new Set(targetPaths.map((candidate) => scope(root, candidate) ?? candidate));
  return [...editedCode].every(
    (edited) => direct.has(edited) || resolved.has(scope(root, edited) ?? edited),
  );
};

const recordCompletedCheck = (
  ctx: Plugin.Context,
  sessionID: Tool.Context["sessionID"],
  root: string,
  targetPaths: ReadonlyArray<string>,
) =>
  Effect.gen(function* () {
    const prev = memoryOf(sessionID);
    const full = coversEditedPaths(root, targetPaths, prev.editedCode);
    remember(sessionID, {
      ...prev,
      touched: prev.touched + 1,
      measured: {
        ...prev.measured,
        delta: prev.editedCode.size,
        ...(full ? { affected: prev.editedCode.size } : {}),
      },
    });
    yield* recordCheck(ctx.storage, ctx.location.project.id, sessionID, full);
  });

const absentSummary = (health: Exclude<Health, { readonly kind: "ready" }>): string =>
  health.kind === "stale"
    ? `${health.binary} is version ${health.version}, older than 0.6.10. Run ripwire --doctor.`
    : `${health.why}. Install it:\n${INSTALL}`;

const runCheck = (ctx: Plugin.Context, input: typeof RipwireInput.Type, context: Tool.Context) =>
  Effect.gen(function* () {
    const root = yield* rootOf(ctx, context.sessionID);
    yield* ctx.permission.assert({
      sessionID: context.sessionID,
      agent: context.agent,
      action: "read",
      resources: [root],
      source: { type: "tool", messageID: context.messageID, id: context.id },
    });

    const health = yield* Effect.promise(() => probe());
    if (health.kind !== "ready") {
      const output = emptyCheck("absent", absentSummary(health));
      return { output, content: output.summary };
    }

    const selected = yield* Effect.promise(() =>
      resolveTargetPaths(root, input.paths, memoryOf(context.sessionID).editedCode),
    );
    if (selected.kind === "refused") {
      const output = emptyCheck("refused", selected.summary);
      return { output, content: output.summary };
    }
    if (selected.kind === "empty") {
      const output = emptyCheck("nothing-edited", "No code files were edited in this session.");
      return { output, content: output.summary };
    }

    const run = yield* Effect.promise(() =>
      executeCheckSpawns(health.binary, root, selected.paths),
    );
    if (run.ok) yield* recordCompletedCheck(ctx, context.sessionID, root, selected.paths);
    return { output: run.output, content: run.output.summary };
  });

export const ripwire = (
  ctx: Plugin.Context,
): Tool.Info<typeof RipwireInput, typeof RipwireOutput> => ({
  name: "ripwire",
  description: CONTRACT.ripwire,
  input: RipwireInput,
  output: RipwireOutput,
  options: { namespace: "spectre", codemode: true },
  execute: (input, context) =>
    (input.action ?? "check") === "report" ? runReport(ctx) : runCheck(ctx, input, context),
});
