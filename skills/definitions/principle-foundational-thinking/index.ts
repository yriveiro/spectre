import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const principleFoundationalThinking: Definition = {
  id: Skill.ID.make("principle-foundational-thinking"),
  name: Skill.Name.make("principle-foundational-thinking"),
  description:
    "Get the data structures and the scaffold right first, so everything downstream turns obvious and more than one future stays cheap. Load it at the start of multi-phase work, before downstream code exists, when the data shape, the seams between the modules, or the scaffold everything else hangs on are not decided yet, and when every later phase depends on what you settle now. The test is forward-looking: does every subsequent phase benefit from this existing, and can you name one that does. Removing what the new structure makes redundant is principle-laziness-protocol, and proving the foundation holds before building on it is principle-verification.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
