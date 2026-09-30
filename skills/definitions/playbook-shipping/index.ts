import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const playbookShipping: Definition = {
  id: Skill.ID.make("playbook-shipping"),
  name: Skill.Name.make("playbook-shipping"),
  description:
    "Land a stack of pull requests, one at a time, from the bottom up. Reach for it when the user says ship it, land the stack, or merge PR 412, and the stack is already merge-ready: verify each pull request independently, stop at the first one that fails, then merge the verified run and report. Not for getting a stack green, which is playbook-babysit, and it merges nothing the human did not ask for. You call it. Nothing in this set calls it for you.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
