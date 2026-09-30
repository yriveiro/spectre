import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const playbook: Definition = {
  id: Skill.ID.make("playbook"),
  name: Skill.Name.make("playbook"),
  description:
    "Pick the right procedure for the shape of task in front of you, from twenty-two of them, and say which one you picked before starting it. Reach for it when a request is big enough that the order of the steps matters: a bug, a feature, a refactor, something too slow, something to be fixed overnight, a stack of pull requests to land. Read it when a bare request could be done two honest ways, because the difference between picking the right procedure and the wrong one is most of the work. `spectre-mode` routes to principles; this routes to whole tasks. It calls them for you, which no other skill in this set does.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
