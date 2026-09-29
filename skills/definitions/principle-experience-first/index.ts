import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

/**
 * The discipline of choosing what the user feels over what is cheap to ship.
 *
 * Applies at the single point where convenience and delight conflict and only
 * one can win. The temptation is always addition: one more flag, one more
 * option, one more mode that satisfies a request without a decision. This leaf
 * owns that moment and the narrower claim inside it, that a small finished
 * surface beats a wide adequate one.
 *
 * There is deliberately no falsifiable test here. No command reports that an
 * experience is right, so the leaf names the moment instead of a check.
 */
export const principleExperienceFirst: Definition = {
  id: Skill.ID.make("principle-experience-first"),
  name: Skill.Name.make("principle-experience-first"),
  description:
    "When convenience and delight conflict, choose delight and ship fewer polished features. Load it when you are tempted to add one more flag, option, or mode instead of deciding, when you are spreading polish evenly across a wide surface instead of concentrating it where the user spends their time, or when a request can be satisfied by cutting rather than adding. There is no falsifiable test here, only the moment, so name which user doing what feels the difference. Refusing the addition before it exists is principle-laziness-protocol, and proving what shipped still holds is principle-verification.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
