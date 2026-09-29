import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

/**
 * Why this is registered and not indexed: `skills/FOR_AGENTS.md`, rule 3.
 *
 * Distinct from `arena`, and the difference is the output. A swarm reports on
 * work that was going to happen anyway. An arena builds one artifact out of
 * several attempts at the same thing, and the picking is the point. A swarm
 * cannot invent a design you have not asked for yet.
 */
export const swarm: Definition = {
  id: Skill.ID.make("swarm"),
  name: Skill.Name.make("swarm"),
  description:
    "Put work out to several workers at once and come back with one report. Reach for it when the job splits into pieces that do not need each other: coverage across slices, a race where several workers try the same brief and you take the best, or a gauntlet that has to finish before you can answer. You call it. Nothing in this set calls it for you.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
