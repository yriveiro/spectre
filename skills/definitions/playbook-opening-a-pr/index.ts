import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const playbookOpeningAPr: Definition = {
  id: Skill.ID.make("playbook-opening-a-pr"),
  name: Skill.Name.make("playbook-opening-a-pr"),
  description:
    "Turn finished work into pull requests a reviewer can land: a worktree per branch, small ordered commits, a split on cohesion rather than line count, Conventional Commit titles, a briefing-shaped body, and a stack that targets its parent rather than main. Reach for it the moment the work is done and the URL is what the user is waiting on, or when a pull request body reads like a lab notebook, or when one branch has grown several unrelated changes. Not for getting a stack green or landing it, which are playbook-babysit and playbook-shipping. You call it. Nothing in this set calls it for you.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
