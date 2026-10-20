import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const principleExhaustTheDesignSpace: Definition = {
  id: Skill.ID.make("principle-exhaust-the-design-space"),
  name: Skill.Name.make("principle-exhaust-the-design-space"),
  description:
    "Load it when nobody has built this before: no precedent in the codebase, nothing here does it yet, and a wrong choice costs more than a second try. Do not settle for the first design and do not just write the obvious one, because one idea is not a choice and the first idea arrives as a guess with total confidence. Build two or three competing versions, compare them on the same evidence, then commit, because a design chosen from one option was never chosen at all. A decision with precedent is principle-laziness-protocol, reuse before you invent, and prototypes that keep failing under one shared belief are principle-attack-the-premise.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
