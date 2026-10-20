import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const principleModelTheDomain: Definition = {
  id: Skill.ID.make("principle-model-the-domain"),
  name: Skill.Name.make("principle-model-the-domain"),
  description:
    "Encode what the code is about in a structure instead of scattering it across conditionals. Load it when a new case arrives as one more branch on an if/else chain, when the same flag is checked in three places, when a value that should be impossible keeps showing up at runtime, when adding a state means touching every function that mentions the old ones, or when the code has no word for the thing it models and knows only the fields underneath. Put the shape of the domain into a state machine, a map, or a discriminated union so that an invalid state cannot be built, then let the code match on the structure instead of re-deriving it. A check duplicated in five places is one decision made five times, and the sixth time someone will get it wrong. Keeping one branch readable is principle-laziness-protocol; making the wrong state unrepresentable is this one.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
