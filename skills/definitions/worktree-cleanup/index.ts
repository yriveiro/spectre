import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const worktreeCleanup: Definition = {
  id: Skill.ID.make("worktree-cleanup"),
  name: Skill.Name.make("worktree-cleanup"),
  description:
    "Reclaim disk from abandoned worktrees without losing work. Reach for it when `git worktree list` is longer than the work in it: a merged branch still holding a directory, a stack that landed last week, a scratch tree from an experiment. Call `tools.spectre.worktrees({})` first and let its bucket decide, because that judgement is a pure function of the git state and re-deriving it by eye is how a branch gets deleted early. It never deletes; you call it. Nothing in this set calls it for you.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
