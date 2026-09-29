import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

/**
 * The discipline of deciding the ground before building on it.
 *
 * Applies at the start of multi-phase work, before downstream code exists,
 * while data shapes, module seams, and the scaffold everything else hangs on
 * are still cheap to change. Effort spent on the foundation pays every later
 * phase. Effort spent downstream on a bad foundation pays once and charges
 * interest.
 *
 * The test is forward-looking: does every subsequent phase benefit from this
 * existing, and can you name one that does. A foundation you cannot name a
 * beneficiary for is a monument, and a scaffold that assumes the answer has
 * already spent the option value it was meant to protect.
 */
export const principleFoundationalThinking: Definition = {
  id: Skill.ID.make("principle-foundational-thinking"),
  name: Skill.Name.make("principle-foundational-thinking"),
  description:
    "Get the data structures and the scaffold right first, so everything downstream turns obvious and more than one future stays cheap. Load it at the start of multi-phase work, before downstream code exists, when data shapes, module seams, or the scaffold everything else hangs on are still cheap to change. The test is forward-looking: does every subsequent phase benefit from this existing, and can you name one that does. Removing what the new structure makes redundant is principle-laziness-protocol, and proving the foundation holds before building on it is principle-verification.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
