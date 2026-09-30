import { join } from "node:path";
import type { ListedWorktree } from "./read";

export const BUCKETS = ["hold-wip", "hold-unpushed", "safe", "review"] as const;

export type Bucket = (typeof BUCKETS)[number];

export const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REF = /^[A-Za-z0-9._/-]+$/;
export const NAME_MAX = 40;

/**
 * `origin/HEAD` first because a project's trunk is not reliably called `main`, and
 * `HEAD` last only as a fallback: the host's own default start point is the source
 * checkout's current branch, which is how a worktree gets cut off a feature.
 */
export const BASES = ["origin/HEAD", "origin/main", "main", "HEAD"] as const;

export const nameProblem = (name: string): string | undefined => {
  if (name === "") return "name is empty";
  if (name.length > NAME_MAX) return `name is longer than ${NAME_MAX} characters`;
  if (!NAME.test(name))
    return "name must be lowercase kebab-case: letters and digits, single hyphens between them";
  return undefined;
};

export const branchProblem = (branch: string): string | undefined => {
  if (branch === "") return "branch is empty";
  if (branch.length > 100) return "branch is longer than 100 characters";
  if (!REF.test(branch)) return "branch has a character git does not allow in a ref name";
  if (branch.startsWith("-")) return "branch may not start with a hyphen";
  if (branch.startsWith("/") || branch.endsWith("/")) return "branch may not start or end with a slash";
  if (branch.includes("//")) return "branch may not contain //";
  if (branch.includes("..")) return "branch may not contain ..";
  if (branch.endsWith(".lock")) return "branch may not end in .lock";
  return undefined;
};

export const startProblem = (name: string, branch: string): string | undefined =>
  nameProblem(name) ?? branchProblem(branch);

/**
 * Tracked edits, counted once, for both consumers. `audit` renders it into a row and
 * `session-return` renders it into a sentence, but what counts as a tracked edit is
 * decided here exactly once.
 */
export const trackedChanges = (porcelain: string): { tracked: number; scratch: number } => {
  if (porcelain === "") return { tracked: 0, scratch: 0 };
  const lines = porcelain.split("\n");
  return {
    tracked: lines.filter((line) => !line.startsWith("??")).length,
    scratch: lines.filter((line) => line.startsWith("??")).length,
  };
};

export const dirtyLabel = (changes: { tracked: number; scratch: number }): string =>
  dirtyOf(trackedOf(changes));

/**
 * A read that failed is its own value, never the reassuring one. `unknown` is not
 * `clean`, and `clean` is what the delete decision reads as a licence.
 *
 * `Tracked` is the one spelling of these four states: the survey counts them, the
 * buckets read them, and the session-return sentence formats them. A second union
 * carrying the same four would let the two disagree about what a clean tree is.
 */
export type Tracked =
  | { readonly kind: "clean" }
  | { readonly kind: "wip"; readonly count: number }
  | { readonly kind: "scratch"; readonly count: number }
  | { readonly kind: "unknown" };

export const trackedOf = (changes: { tracked: number; scratch: number }): Tracked => {
  if (changes.tracked > 0) return { kind: "wip", count: changes.tracked };
  if (changes.scratch > 0) return { kind: "scratch", count: changes.scratch };
  return { kind: "clean" };
};

export const dirtyOf = (tracked: Tracked): string => {
  if (tracked.kind === "wip") return `wip:${tracked.count}`;
  if (tracked.kind === "scratch") return `scratch:${tracked.count}`;
  return tracked.kind;
};

export type Evidence = {
  readonly dirty: Tracked;
  /** HEAD is an ancestor of `origin/main`. `unknown` when the ref does not resolve. */
  readonly merged: boolean | "unknown";
  /**
   * The `git cherry origin/main <branch>` verdict. Measured: an N-into-1 squash reads
   * `unlanded` because the patch was rewritten, so ancestry can miss landed work and
   * this is the other half of the answer.
   */
  readonly patches: "landed" | "unlanded" | "unknown";
  /** A remote-tracking ref exists for the branch, as of the last fetch. */
  readonly pushed: boolean | "unknown";
};

/**
 * The rule, in the order it decides: tracked edits outrank everything, then proof the
 * work already landed, then proof that no other copy exists. A pushed-but-unlanded
 * branch may carry an open pull request, which git cannot see, so it stays in `review`
 * and the forge gets the last word before anything is deleted.
 *
 * `safe` means deletion loses nothing the author was holding. It does not mean the
 * work was good.
 */
export const bucket = (evidence: Evidence): Bucket => {
  if (evidence.dirty.kind === "wip") return "hold-wip";
  if (evidence.merged === true || evidence.patches === "landed") return "safe";
  if (evidence.pushed === false) return "hold-unpushed";
  return "review";
};

export const count = (worktrees: ReadonlyArray<{ readonly bucket: Bucket }>) =>
  worktrees.reduce(
    (tally, one) => ({ ...tally, [one.bucket]: tally[one.bucket] + 1 }),
    Object.fromEntries(BUCKETS.map((name) => [name, 0])) as Record<Bucket, number>,
  );

/**
 * A branch name outlives its pull request, so one name can carry several. The match
 * that still holds somebody up wins: a closed request is proof the author let it go.
 */
export const prFor = (branch: string, pulled: ReadonlyArray<PullRequest>): string => {
  const matching = pulled.filter((one) => one.headRefName === branch);
  const open = matching.find((one) => one.state === "OPEN");
  const found = open ?? matching[0];
  return found === undefined ? "-" : `#${found.number}/${found.state}`;
};

export type PullRequest = { readonly number: number; readonly state: string; readonly headRefName: string };

/**
 * Everything a start needs to know, gathered by one read of `git worktree list
 * --porcelain` plus three independent lookups.
 *
 * `rows` is the parse itself rather than two booleans derived from it, because "which
 * directory is main" and "is this name taken" must come from the same reading.
 */
export type Start = {
  readonly name: string;
  readonly branch: string;
  /** Where the worktree would go, so a taken name is an exact path match. */
  readonly root: string;
  readonly base: string | undefined;
  readonly branchExists: boolean;
  /** The calling session's directory, or undefined when the call has no session. */
  readonly sessionDirectory: string | undefined;
  readonly rows: ReadonlyArray<ListedWorktree>;
};

export type Refusal =
  | { readonly kind: "invalid"; readonly why: string }
  | { readonly kind: "wrong-session"; readonly why: string }
  | { readonly kind: "already-taken"; readonly why: string }
  | { readonly kind: "no-base"; readonly why: string };

const mainOf = (rows: ReadonlyArray<ListedWorktree>) =>
  rows.find((one) => one.branch === "main")?.directory;

/**
 * Ordered, and the order is the contract: a session that cannot be placed is told that
 * before anything about the repository is consulted, because "you are nested" is the
 * fact the caller has to act on, and a second refusal about a taken name would only
 * obscure it.
 *
 * A session in the main worktree is the only place a start may happen from. The
 * no-main case is a refusal too: without a main row there is no "the main worktree"
 * to compare against, and proceeding is the one outcome that creates a worktree
 * inside a working tree.
 */
export const refusal = (start: Start): Refusal | undefined => {
  const invalid = startProblem(start.name, start.branch);
  if (invalid !== undefined) return { kind: "invalid", why: invalid };

  if (start.sessionDirectory === undefined)
    return {
      kind: "wrong-session",
      why: "this call has no session, so there is nothing to move into the worktree. Open a session in the project's main worktree and call it again.",
    };

  const main = mainOf(start.rows);
  if (main === undefined)
    return {
      kind: "wrong-session",
      why: `git lists no worktree on main, so this session at ${start.sessionDirectory} cannot be placed, and the new worktree would be created inside it. Get onto main and call again.`,
    };
  if (start.sessionDirectory !== main)
    return {
      kind: "wrong-session",
      why: `this session is already in ${start.sessionDirectory}, which is not the main worktree (${main}). One worktree per session: move back to ${main}, or work where you are.`,
    };

  const at = join(start.root, start.name);
  const taken = start.rows.find((one) => one.directory === at);
  if (taken !== undefined)
    return {
      kind: "already-taken",
      why: `a worktree named ${start.name} already exists at ${at}, and the host would silently create ${start.name}-2 instead`,
    };
  if (start.branchExists)
    return {
      kind: "already-taken",
      why: `branch ${start.branch} already exists; the worktree would be created detached and then fail to attach to it. Pick another name, or delete that branch first`,
    };

  if (start.base === undefined)
    return {
      kind: "no-base",
      why: `no base ref resolved; tried ${BASES.join(", ")}. Fetch, or pass \`base\` explicitly.`,
    };

  return undefined;
};

export type Reads = {
  readonly listed: boolean;
  /** `undefined` when git could not be run there, which is not a HEAD of "". */
  readonly head: string | undefined;
  readonly expected: string;
  readonly branch: string | undefined;
  readonly wanted: string;
};

export const mismatch = (reads: Reads): string | undefined => {
  if (!reads.listed) return "git does not list the directory";
  if (reads.head === undefined) return "git could not read HEAD in the new worktree";
  if (reads.head !== reads.expected)
    return `HEAD is ${reads.head}, and the base resolved to ${reads.expected}`;
  if (reads.branch === undefined) return "git could not read the branch in the new worktree";
  if (reads.branch !== reads.wanted) return `it is on ${reads.branch}, not ${reads.wanted}`;
  return undefined;
};
