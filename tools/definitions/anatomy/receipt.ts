import { join } from "node:path";
import { dataRoot } from "../canvas/store";

/**
 * What the check proved, kept beside the figure so the hook can read it.
 *
 * A receipt is the only thing the hook needs: re-running the audit needs the
 * figure's own module, and a hook cannot safely import the caller's code on the
 * way to deciding whether to show a page. So the tool writes what it measured
 * and the hook reads it.
 */
export interface Receipt {
  readonly passed: boolean;
  readonly failures: ReadonlyArray<string>;
  readonly at: string;
  readonly file: string;
}

/**
 * Receipts live in a plugin-owned cache rather than in the reader's project.
 *
 * A receipt is evidence about one build of one figure, so it must never turn up
 * in a diff or travel with the source.
 */
const root = (): string => join(dataRoot, "anatomy");

const receiptFor = (id: string): string => join(root(), `${id.replace(/[^a-z0-9-]/gi, "_")}.json`);

/** The marker that says a canvas is a figure and is subject to the audit. */
const figureFor = (id: string): string => join(root(), `${id.replace(/[^a-z0-9-]/gi, "_")}.figure`);

const exists = async (path: string): Promise<boolean> => Bun.file(path).exists();

export const isFigure = async (id: string): Promise<boolean> => exists(figureFor(id));

export const markFigure = async (id: string): Promise<void> => {
  await Bun.write(figureFor(id), id);
};

export const writeReceipt = async (id: string, receipt: Receipt): Promise<void> => {
  await Bun.write(receiptFor(id), JSON.stringify(receipt));
};

/**
 * The last receipt, or null when there is none.
 *
 * A receipt that cannot be read is treated as no receipt, so a corrupt cache
 * never locks a figure out of being shown.
 */
export const readReceipt = async (id: string): Promise<Receipt | null> => {
  try {
    const parsed: unknown = JSON.parse(await Bun.file(receiptFor(id)).text());
    if (typeof parsed !== "object" || parsed === null) return null;
    const row = parsed as Partial<Receipt>;
    if (typeof row.passed !== "boolean" || !Array.isArray(row.failures)) return null;
    return {
      passed: row.passed,
      failures: row.failures.filter((one): one is string => typeof one === "string"),
      at: typeof row.at === "string" ? row.at : "",
      file: typeof row.file === "string" ? row.file : "",
    };
  } catch {
    return null;
  }
};
