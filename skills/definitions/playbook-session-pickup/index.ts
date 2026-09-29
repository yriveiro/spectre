import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

/**
 * Why this is registered and not indexed: `skills/FOR_AGENTS.md`, rule 3.
 *
 * The resume point is a branch and a diff. Reasoning that never became a commit
 * is not in git, and the body says so at the point a reader would otherwise infer
 * it from a confident summary.
 */
export const playbookSessionPickup: Definition = {
  id: Skill.ID.make("playbook-session-pickup"),
  name: Skill.Name.make("playbook-session-pickup"),
  description:
    "Take over work another session left in flight: find the branch and the worktree, read what actually landed and what did not, and name the resume point without redoing any of it. Reach for it when you are handed a half-finished branch, a worktree that is dirty or diverged, a session that ended mid-change, or a colleague's commit range to continue. Not for starting work of your own, and not for deciding what to do about a stack of branches, which is `tools.spectre.stack`. There are no agent transcripts to read in this setup, so the evidence is git plus what is on disk, and the recovery path is a diff you can run rather than a trail you can quote.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
