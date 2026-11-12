import type { Contract, Feature, GoalView } from "./contract";
import { ledgerPath } from "./contract";

/**
 * The ledger is prose, and this module owns its header. The model appends one
 * row per round; nothing here parses a row or rewrites an earlier section.
 *
 * The file is the durable half. The host keeps only `Goal.State` (objective,
 * status, rounds, the reviewer's last reason), and a continuation carries one
 * reviewer sentence. After a pause, a restart or a compaction, `.spectre/run.md`
 * is what a later round or a later session reads.
 */

export type HeaderWrite =
  | { readonly status: "written" }
  | { readonly status: "present" }
  | { readonly status: "failed"; readonly why: string };

const header = (goal: GoalView, contract: Contract, place: Feature, sessionID: string): string =>
  [
    `## Goal ${goal.id}`,
    "",
    `- Objective: ${contract.objective}`,
    `- Session: ${sessionID}`,
    `- Worktree: ${place.directory} (branch ${place.branch})`,
    `- Exit: ${contract.predicate}`,
    `- Check: ${contract.check}`,
    ...(contract.evidence === undefined ? [] : [`- Evidence also required: ${contract.evidence}`]),
    `- Armed: ${new Date(goal.updatedAt).toISOString()}`,
    "",
    "| round | changed | check output | predicate moved | head |",
    "| ----- | ------- | ------------ | --------------- | ---- |",
    "",
  ].join("\n");

/**
 * Append the section once. A second `arm` for the same goal — the idempotent
 * path — finds its id already there and writes nothing.
 */
export const ensureHeader = async (
  goal: GoalView,
  contract: Contract,
  place: Feature,
  sessionID: string,
): Promise<HeaderWrite> => {
  try {
    const path = ledgerPath(place.directory);
    const file = Bun.file(path);

    if (await file.exists()) {
      const text = await file.text();
      const heading = `## Goal ${goal.id}`;
      if (text.split("\n").some((line) => line.trim() === heading)) return { status: "present" };
      const tail = text.replace(/\s*$/, "");
      await Bun.write(
        path,
        `${tail === "" ? "" : `${tail}\n\n`}${header(goal, contract, place, sessionID)}\n`,
      );
      return { status: "written" };
    }

    await Bun.write(path, `${header(goal, contract, place, sessionID)}\n`);
    return { status: "written" };
  } catch (cause) {
    return { status: "failed", why: cause instanceof Error ? cause.message : String(cause) };
  }
};
