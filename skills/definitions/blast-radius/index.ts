import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const blastRadius: Definition = {
  id: Skill.ID.make("blast-radius"),
  name: Skill.Name.make("blast-radius"),
  description:
    "Work out what a change breaks somewhere else before it lands, and prove the one fact it is safe because of by running the real code instead of writing it up. Reach for it when you are about to merge a diff you did not trace, or when somebody asks what changing a function, a config value or a data shape takes with it somewhere you did not touch. It is not a caller list, because the caller list is one command and ripwire.impact already has it. You call it. Nothing in this set calls it for you.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
