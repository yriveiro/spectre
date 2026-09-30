import type { AbsolutePath } from "@opencode/schema/schema";
import type { Session } from "@opencode/schema/session";
import type { Tracked } from "../classify";

export type Branch =
  | { readonly kind: "named-by-git"; readonly name: string }
  | { readonly kind: "recovered-from-path"; readonly name: string }
  | { readonly kind: "unrecoverable"; readonly why: string };

export type Landing =
  | { readonly kind: "on-main"; readonly by: "ancestor" | "merged-pr" }
  | { readonly kind: "not-on-main"; readonly since: number }
  | { readonly kind: "unknown"; readonly why: string };

export type Standing = {
  readonly session: Session.ID;
  readonly where: { readonly lost: AbsolutePath; readonly onDisk: boolean };
  readonly main:
    | { readonly kind: "found"; readonly directory: AbsolutePath; readonly dirty: Tracked }
    | { readonly kind: "absent"; readonly why: string };
  /** Commits main is behind `origin/main`, or undefined when that ref is unknown. */
  readonly behind: number | undefined;
  readonly branch: Branch;
  readonly landing: Landing;
};

export type Return =
  | { readonly kind: "left-alone" }
  | { readonly kind: "went-home" }
  | { readonly kind: "went-home-caught-short" }
  | { readonly kind: "held" };

const branchName = (branch: Branch): string | undefined =>
  branch.kind === "unrecoverable" ? undefined : branch.name;

export const home = (s: Standing): Return => {
  if (s.where.onDisk) return { kind: "left-alone" };
  if (s.main.kind === "absent") return { kind: "held" };
  const behind = s.behind !== undefined && s.behind > 0;
  const dirty = s.main.dirty.kind === "wip";
  if (s.landing.kind === "on-main" && !behind && !dirty) return { kind: "went-home" };
  return { kind: "went-home-caught-short" };
};

const clause = (s: Standing): string => {
  const name = branchName(s.branch);
  if (name === undefined) return "The branch it held could not be identified.";
  if (s.landing.kind === "on-main") return `Branch ${name} is on main.`;
  if (s.landing.kind === "not-on-main")
    return `Branch ${name} is NOT on main: ${s.landing.since} commits on it are not in main. Do not assume the work you were doing is here.`;
  return `Whether the work on ${name} reached main could not be established: ${s.landing.why}`;
};

export const say = (s: Standing): string => {
  const verdict = home(s);
  if (verdict.kind === "left-alone") return "";

  if (s.main.kind === "absent")
    return `This session was working in ${s.where.lost}, which no longer exists, and this repository has no worktree on main, so there was nowhere to move to. The session was not moved. ${clause(s)}`;

  if (verdict.kind === "went-home")
    return `This session was working in ${s.where.lost}, which no longer exists. It moved to ${s.main.directory}. ${clause(s)}`;

  const reasons: Array<string> = [];
  if (s.main.dirty.kind === "wip") reasons.push(`main has ${s.main.dirty.count} tracked changes`);
  if (s.behind !== undefined && s.behind > 0)
    reasons.push(`main is ${s.behind} commits behind origin/main`);
  if (s.landing.kind !== "on-main") reasons.push("the work is not confirmed on main");

  return `This session was working in ${s.where.lost}, which no longer exists. It moved to ${s.main.directory}, which was not advanced: ${reasons.join("; ")}. Updating main is your call; this is what is there now. ${clause(s)}`;
};
