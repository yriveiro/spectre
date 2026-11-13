import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const playbookWorktree: Definition = {
  id: Skill.ID.make("playbook-worktree"),
  name: Skill.Name.make("playbook-worktree"),
  description:
    "Open a worktree for a unit of work, and close it when the work ends. Reach for it when a change needs its own directory and branch without touching the checkout everybody shares, when `tools.spectre.worktrees({ action: \"start\" })` refuses, or when a session is standing in the wrong tree. It covers the name and base, the one call that moves the session, every status, and removal. Reclaiming several abandoned trees is `worktree-cleanup`. You call it. Nothing in this set calls it for you.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
