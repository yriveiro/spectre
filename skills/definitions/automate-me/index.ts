import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const automateMe: Definition = {
  id: Skill.ID.make("automate-me"),
  name: Skill.Name.make("automate-me"),
  description:
    "Draft a personal skill out of how the reader already works, so an agent follows their conventions without being asked each time. Reach for it when someone says automate me, or make a skill in my style, or turn my preferences into something an agent applies, and either no such skill exists or one exists and has drifted: the request is a person-shaped behaviour rather than a bug, a feature, or a design. It mines the commit history and the skills already installed, asks what the mining cannot see, and drops a rule the evidence does not carry. You call it. Nothing in this set calls it for you.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
