export const BUCKETS = ["hold-wip", "hold-open-pr", "safe", "review"] as const;

export type Bucket = (typeof BUCKETS)[number];

export type Evidence = {
  /** HEAD is an ancestor of `origin/main`. False when `origin/main` is unknown. */
  readonly merged: boolean;
  /** `clean`, `wip:<n>`, or `scratch:<n>`. */
  readonly dirty: string;
  /** `#<number>/<state>`, or `-` when the branch has no PR. */
  readonly pr: string;
};

/**
 * The rule, in the order it decides: tracked edits outrank everything, then an
 * open PR, then proof the work already landed. `pr !== "-"` accepts a CLOSED PR
 * as proof, so a rejected branch reads as `safe`; that is deliberate and the
 * tool's description says so, because `safe` means "deletion loses nothing the
 * author wanted kept", not "this branch was good".
 */
export const bucket = (evidence: Evidence): Bucket => {
  if (evidence.dirty.startsWith("wip:")) return "hold-wip";
  if (evidence.pr.includes("OPEN")) return "hold-open-pr";
  if (evidence.merged || evidence.pr !== "-") return "safe";
  return "review";
};

export const count = (worktrees: ReadonlyArray<{ readonly bucket: Bucket }>) =>
  worktrees.reduce(
    (tally, one) => ({ ...tally, [one.bucket]: tally[one.bucket] + 1 }),
    Object.fromEntries(BUCKETS.map((name) => [name, 0])) as Record<Bucket, number>,
  );

export type PullRequest = {
  readonly number: number;
  readonly state: string;
  readonly headRefName: string;
};

/** `-` means no PR, which is what every merge and remote rule downstream reads. */
export const prFor = (branch: string, pulled: ReadonlyArray<PullRequest>): string => {
  const found = pulled.find((one) => one.headRefName === branch);
  return found === undefined ? "-" : `#${found.number}/${found.state}`;
};
