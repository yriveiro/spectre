import { join } from "node:path";
import type { ListedWorktree } from "./git";

export const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REF = /^[A-Za-z0-9._/-]+$/;
export const NAME_MAX = 40;

/**
 * `origin/HEAD` first because a project's trunk is not reliably called `main`,
 * and `HEAD` last only as a fallback: the host's own default start point is the
 * source checkout's current branch, which is how a worktree gets cut off a
 * feature instead of off trunk.
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
 * Everything a start needs to know, gathered by one read of
 * `git worktree list --porcelain` plus three independent lookups.
 *
 * `rows` is the parse itself rather than two booleans derived from it, because
 * "which directory is main" and "is this name taken" must come from the same
 * reading. Passing them as separate facts would let a caller answer them from
 * different moments, and the one that decides a refusal is the one that must be
 * current.
 */
export type Start = {
  readonly name: string;
  readonly branch: string;
  /** Where the worktree would go, so `taken` is an exact path match. */
  readonly root: string;
  readonly base: string | undefined;
  readonly branchExists: boolean;
  /** The calling session's directory, or undefined when the call has no session. */
  readonly sessionDirectory: string | undefined;
  readonly rows: ReadonlyArray<ListedWorktree>;
};

export type Refusal =
  | { readonly kind: "invalid"; readonly why: string }
  | { readonly kind: "session-on-worktree"; readonly why: string }
  | { readonly kind: "no-session"; readonly why: string }
  | { readonly kind: "name-taken"; readonly why: string }
  | { readonly kind: "branch-exists"; readonly why: string }
  | { readonly kind: "no-base"; readonly why: string };

/**
 * Ordered, and the order is the contract: a session that is already in a
 * worktree is told that before anything about the repository is consulted,
 * because "you are nested" is the fact the caller has to act on, and a second
 * refusal about a taken name would only obscure it.
 */
export const refusal = (start: Start): Refusal | undefined => {
  const invalid = startProblem(start.name, start.branch);
  if (invalid !== undefined) return { kind: "invalid", why: invalid };

  if (start.sessionDirectory === undefined)
    return {
      kind: "no-session",
      why: "this call has no session, so there is nothing to move into the worktree. Open a session in the project's main worktree and call it again.",
    };

  const main = start.rows.find((one) => one.branch === "main")?.directory;
  if (main !== undefined && start.sessionDirectory !== main)
    return {
      kind: "session-on-worktree",
      why: `this session is already in ${start.sessionDirectory}, which is not the main worktree (${main}). One worktree per session: move back to main, or work where you are.`,
    };

  if (start.rows.some((one) => one.directory === join(start.root, start.name)))
    return {
      kind: "name-taken",
      why: `a worktree named ${start.name} already exists, and the host would silently create ${start.name}-2 instead`,
    };

  if (start.branchExists)
    return {
      kind: "branch-exists",
      why: `branch ${start.branch} already exists; pick another name or delete that branch first`,
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
  readonly head: string;
  readonly expected: string;
  readonly branch: string;
  readonly wanted: string;
};

export const mismatch = (reads: Reads): string | undefined => {
  if (!reads.listed) return "git does not list the directory";
  if (reads.head !== reads.expected)
    return `HEAD is ${reads.head}, and the base resolved to ${reads.expected}`;
  if (reads.branch !== reads.wanted) return `it is on ${reads.branch}, not ${reads.wanted}`;
  return undefined;
};
