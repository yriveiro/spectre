import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const swarm: Definition = {
  id: Skill.ID.make("swarm"),
  name: Skill.Name.make("swarm"),
  description:
    "Put work out to several workers at once and come back with one report. Reach for it when the job splits into pieces that do not need each other: coverage across slices, a race where several workers try the same brief and you take the best, or a gauntlet that has to finish before you can answer. You call it. Nothing in this set calls it for you.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
