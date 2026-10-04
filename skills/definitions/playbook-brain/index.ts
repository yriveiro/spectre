import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const playbookBrain: Definition = {
  id: Skill.ID.make("playbook-brain"),
  name: Skill.Name.make("playbook-brain"),
  description:
    "The question is \"what do we already know about this project\", or a fact landed that the repo does not contain. Loads the brain for a recall, and records a gotcha, a decision or a lesson as tools.spectre.brain neurons and synapses.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
