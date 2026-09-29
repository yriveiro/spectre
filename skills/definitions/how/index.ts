import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

/**
 * Why this is registered and not indexed: `skills/FOR_AGENTS.md`, rule 3.
 *
 * Distinct from `principle-evidence`, which owns obtaining the proof. This owns
 * the writing: a subsystem explained to a person who has to answer a question
 * about it afterwards. `ripwire.explore` is the orientation call, and the two
 * overlap in neither direction, because a ranked map is not an explanation and an
 * explanation is not proof.
 */
export const how: Definition = {
  id: Skill.ID.make("how"),
  name: Skill.Name.make("how"),
  description:
    "Explain a subsystem end to end and hand back something a senior engineer could work from: what triggers it, what the flow is, where the files are, and the things a newcomer would get wrong. Reach for it when you are about to change code you have only skimmed, or when somebody asks how a part of the system works and the answer has to hold up in review. It is not the evidence skill, which gets the proof; this one explains the thing to a person. You call it. Nothing in this set calls it for you.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
