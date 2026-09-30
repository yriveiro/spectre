import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const teach: Definition = {
  id: Skill.ID.make("teach"),
  name: Skill.Name.make("teach"),
  description:
    "Explain a change or a subsystem until the person could have reasoned their way to it, rather than until they hold a summary of it, and change nothing while you do it. Reach for it when somebody asks to be walked through work they did not write and do not yet have in their head: a colleague joining the area, a reviewer who has to sign off on the design, or a question that came back twice because the premise never got explained. You call it. Nothing in this set calls it for you.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
