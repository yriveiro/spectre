import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

/**
 * Why this is registered and not indexed: `skills/FOR_AGENTS.md`, rule 3.
 *
 * The boundary here is the audience, not the topic. `how` is the same walkthrough
 * for a reader who already has the code in front of them; `teach` is for a reader
 * who does not have it in their head yet and starts one level earlier, at what
 * the thing is. `i-have-adhd` owns the shape of the message and picks no depth,
 * so it never decides how much of this to hand over.
 */
export const teach: Definition = {
  id: Skill.ID.make("teach"),
  name: Skill.Name.make("teach"),
  description:
    "Explain a change or a subsystem until the person could have reasoned their way to it, rather than until they hold a summary of it, and change nothing while you do it. Reach for it when somebody asks to be walked through work they did not write and do not yet have in their head: a colleague joining the area, a reviewer who has to sign off on the design, or a question that came back twice because the premise never got explained. You call it. Nothing in this set calls it for you.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
