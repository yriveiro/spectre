import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const principleVerification: Definition = {
  id: Skill.ID.make("principle-verification"),
  name: Skill.Name.make("principle-verification"),
  description:
    "Did you actually run it? Load it before you say done, before you say it is safe to push or ship, before you confirm a check passed or the typecheck is green, and before you write or edit a version, a manifest, a lockfile, a README, a release note, or any other line somebody will trust without re-deriving it. Run the command, then make the claim, and name plainly what you did not check. A claim you did not run is a guess with punctuation. Which claim no longer holds is ripwire's question, and a fact nobody checked at all is principle-evidence's other half.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
