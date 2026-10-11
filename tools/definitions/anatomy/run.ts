import { resolve } from "node:path";
import type { AbsolutePath } from "@opencode/schema/schema";
import { audit, type Item, type Recorder, report, settle } from "./kit/audit";
import { markFigure, writeReceipt } from "./receipt";

/**
 * Run the audit over a figure's own build module.
 *
 * The module is imported here, so the figure is measured from the same shapes
 * it was drawn from rather than from a second description of them. That is also
 * why this runs the caller's code: `check` is for a script the caller wrote or
 * read.
 */

/** What a build module has to export for the audit to have anything to measure. */
interface Figure {
  readonly recorder?: Recorder;
}

const reason = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

/**
 * The kit's own directory, which is the only way to name it.
 *
 * The plugin is installed under a hashed cache directory, so a path relative to
 * the caller's project resolves to nothing.
 */
export const kitDirectory = (): string => resolve(import.meta.dir, "kit");

const named = (checks: ReadonlyArray<string> | undefined, wanted: string): boolean =>
  checks === undefined || checks.includes(wanted);

/** The seven checks a caller may switch off; anything else is a typo, not a filter. */
const KNOWN = ["clearance", "apart", "flight", "terminals", "loose", "supports", "depth"] as const;

export interface CheckResult {
  action: "check";
  status: "ok" | "problems" | "unreadable" | "no recorder" | "refused";
  passed: boolean;
  counts?: { tubes: number; solids: number; items: number; states: number };
  failures: string[];
  notes?: string[];
  report?: string;
}

export const runAudit = async (
  directory: AbsolutePath,
  file: string,
  only?: ReadonlyArray<string>,
  canvasId?: string,
): Promise<CheckResult> => {
  // A misspelt check name that silently filters nothing would turn the gate
  // into a pass, so an unknown name is refused instead.
  const unknown = (only ?? []).filter((name) => !(KNOWN as ReadonlyArray<string>).includes(name));
  if (unknown.length > 0)
    return {
      action: "check",
      status: "refused",
      passed: false,
      failures: [`unknown check: ${unknown.join(", ")}. known: ${KNOWN.join(", ")}`],
      report: `unknown check: ${unknown.join(", ")}\nknown: ${KNOWN.join(", ")}`,
    };

  const path = resolve(directory, file);
  let built: unknown;
  try {
    built = await import(path);
  } catch (cause) {
    return {
      action: "check",
      status: "unreadable",
      passed: false,
      failures: [`cannot load ${file}: ${reason(cause)}`],
      report: `cannot load ${file}: ${reason(cause)}`,
    };
  }

  const figure = (built as { default?: Figure }).default ?? (built as Figure);
  const recorded = figure?.recorder;
  if (!recorded) {
    return {
      action: "check",
      status: "no recorder",
      passed: false,
      failures: [`${file} exports no recorder, so there is nothing to prove`],
      report: `${file} exports no recorder, so there is nothing to prove. A build module exports \`{ recorder }\`.`,
    };
  }

  const R = recorded as Recorder;
  if (R.settled === null) settle(R);
  const result = audit(R);
  const counts = result.counts;

  // A check the caller switched off is not silently folded into the pass count.
  const rows = [
    ...(named(only, "clearance") ? result.clearance : []),
    ...(named(only, "apart") ? result.apart : []),
    ...(named(only, "flight") ? result.flight : []),
    ...(named(only, "terminals") ? result.terminals : []),
    ...(named(only, "loose") ? result.loose : []),
    ...(named(only, "supports") ? result.supports : []),
    ...(named(only, "depth") ? result.depth : []),
  ];

  const items: ReadonlyArray<Item> = R.items;
  const notes = [
    ...result.passing,
    ...(only ? [`skipped: ${only.join(", ")}`] : []),
    ...(only && canvasId !== undefined
      ? ["a filtered check writes no receipt, so it cannot clear the present guard"]
      : []),
    ...items
      .filter((item) => item.shapes.length === 0)
      .map((item) => `${item.name} records no shape`),
  ];

  // The receipt is what lets the present guard refuse an unproved figure without
  // re-importing the figure's own module on the way to a decision.
  //
  // A filtered run certifies nothing, so it writes no receipt at all. Writing one
  // from the filtered rows would let `only: ["terminals"]` clear a figure that
  // fails every other check, which is a gate that opens on a typo.
  if (canvasId !== undefined && only === undefined) {
    await markFigure(canvasId);
    await writeReceipt(canvasId, {
      passed: rows.length === 0,
      failures: rows.slice(0, 60).map((row) => row.what),
      at: new Date().toISOString(),
      file,
    });
  }

  return {
    action: "check",
    status: rows.length === 0 ? "ok" : "problems",
    passed: rows.length === 0,
    counts,
    failures: rows.slice(0, 60).map((row) => row.what),
    notes,
    report: report(result),
  };
};
