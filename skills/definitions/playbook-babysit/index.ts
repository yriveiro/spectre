import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const playbookBabysit: Definition = {
  id: Skill.ID.make("playbook-babysit"),
  name: Skill.Name.make("playbook-babysit"),
  description:
    "Work a stack of pull requests up to merge-ready without landing any of them. Reach for it once a phase or a whole stack is already built and the user says babysit this, get it green, or check on PR 412: clear the frontier's conflicts, answer review threads, classify a red check, stop, and report. Not for landing it, which is playbook-shipping, and not for the moment a PR opens, which is playbook-opening-a-pr. You call it. Nothing in this set calls it for you.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
