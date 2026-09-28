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
    "The principle that you never claim more than you have checked. Load it before saying a change is done, before saying it is safe to ship, before confirming that a check passed, and before writing or editing anything that states a fact others will trust: a version, a manifest, a lockfile, a README, a generated artifact, a release note. Run the check, then make the claim, and name plainly what you did not check.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
