import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

/**
 * Why this is registered and not indexed: `skills/FOR_AGENTS.md`, rule 3.
 *
 * Distinct from `principle-make-states-unrepresentable`. That leaf owns the
 * finished type that cannot hold a wrong value; this owns the moment before any
 * code exists, when the shape is still a sketch and throwing it out costs
 * nothing.
 */
export const architect: Definition = {
  id: Skill.ID.make("architect"),
  name: Skill.Name.make("architect"),
  description:
    "Settle the types, the signatures and the module shape on paper before a line of implementation exists, then fill the code in against that sketch and throw the sketch away when the code keeps fighting it. Reach for it when a change is big enough that the wrong shape becomes load-bearing by the time you notice: a new module, a second caller arriving for something that has one, a data shape other code will start depending on. You call it. Nothing in this set calls it for you.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
