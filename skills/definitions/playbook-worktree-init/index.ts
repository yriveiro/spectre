import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const playbookWorktreeInit: Definition = {
  id: Skill.ID.make("playbook-worktree-init"),
  name: Skill.Name.make("playbook-worktree-init"),
  description:
    "Open a fresh worktree for a unit of work, and move this session into it. Reach for it when a change needs its own directory and branch without touching the checkout everybody shares, when `tools.spectre.worktrees({ action: \"start\" })` refuses, or when a session is in the wrong tree. It covers the name and base, the one `start` call, and every result. Closing a worktree is `worktree-cleanup`. You call it. Nothing in this set calls it for you.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
