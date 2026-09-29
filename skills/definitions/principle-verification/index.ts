import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

/**
 * The discipline of never asserting more than has been checked.
 *
 * Split out of a file that was named for upkeep but spent its length on
 * verification. The upkeep half (cleaning while you refactoring, deleting dead
 * code, bumping what is safe to bump) is the principle-hygiene skill next to
 * this one. What remains here is the narrower claim: a fact nobody checked is
 * not a fact, however confidently it is written.
 *
 * Written to outlive the repository it was drafted in. It names no version, no
 * package, and no tool, because a principle that hardcodes any of those has
 * stopped being a way of working and become a note about one moment.
 */
export const principleVerification: Definition = {
  id: Skill.ID.make("principle-verification"),
  name: Skill.Name.make("principle-verification"),
  description:
    "Did you actually run it? Load it before you say done, before you say it is safe to push or ship, before you confirm a check passed or the typecheck is green, and before you write or edit a version, a manifest, a lockfile, a README, a release note, or any other line somebody will trust without re-deriving it. Run the command, then make the claim, and name plainly what you did not check. A claim you did not run is a guess with punctuation. Which claim no longer holds is ripwire's question, and a fact nobody checked at all is principle-evidence's other half.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
