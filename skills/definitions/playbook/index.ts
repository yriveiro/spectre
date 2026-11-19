import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const playbook: Definition = {
  id: Skill.ID.make("playbook"),
  name: Skill.Name.make("playbook"),
  description:
    "Pick the right procedure for the shape of task in front of you, from twenty-five of them, and say which one you picked before starting it. Reach for it when a request is big enough that the order of the steps matters. Read it when a bare request has two honest answers, because the difference between picking the right procedure and the wrong one is most of the work. Query tools.spectre.skills({ category: \"playbook\" }) to browse the twenty-five procedures; this file states the task-shape selection rule.",
  autoinvoke: false,
  catalog: {
    tier: "hub",
    summary: "Task-shape selection rule and long-programme wake rules for ordered multi-phase playbooks",
  },
  path: anchor(import.meta.dir),
};
