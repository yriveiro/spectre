import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

/**
 * The discipline of comparing before committing when nothing precedes you.
 *
 * A novel decision has no precedent to reuse, so the first design is a guess
 * wearing confidence. Two or three competing prototypes turn the guess into a
 * comparison. A decision with precedent is principle-laziness-protocol; prototypes
 * failing under one shared belief are principle-attack-the-premise.
 */
export const principleExhaustTheDesignSpace: Definition = {
  id: Skill.ID.make("principle-exhaust-the-design-space"),
  name: Skill.Name.make("principle-exhaust-the-design-space"),
  description:
    "Do not marry the first design. Load it when the decision is novel, no precedent exists in the tree, and the cost of being wrong exceeds the cost of two or three throwaway prototypes. Build the competing options, compare them on the same evidence, then commit, because a design chosen from one option was never chosen at all. Only a moment: novelty with no precedent. A decision with precedent is principle-laziness-protocol, reuse before you invent, and prototypes that keep failing under one shared belief are principle-attack-the-premise.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
