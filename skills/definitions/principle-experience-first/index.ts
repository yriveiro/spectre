import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const principleExperienceFirst: Definition = {
  id: Skill.ID.make("principle-experience-first"),
  name: Skill.Name.make("principle-experience-first"),
  description:
    "When convenience and delight conflict, choose delight and ship fewer polished features. Load it when you are tempted to add one more flag, option, mode, or setting instead of deciding, when every user carries that decision forever and nobody would notice it, when one part of the app feels slow and the rest is fine, when you are spreading polish evenly across a wide surface instead of concentrating it where people actually spend their time, or when a request can be satisfied by cutting rather than adding. There is no falsifiable test here, only the moment, so name which user doing what feels the difference. Refusing the addition before it exists is principle-laziness-protocol, and proving what shipped still holds is principle-verification.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
