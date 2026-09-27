import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

/**
 * The discipline of never asserting more than has been checked.
 *
 * Split out of a file that was named for upkeep but spent its length on
 * verification. The upkeep half — cleaning while you refactoring, deleting dead
 * code, bumping what is safe to bump — is the principle-hygiene skill next to
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
    "The principle that software claims must be machine-verified rather than asserted. Use when finishing work, reporting findings, declaring something done, or writing anything that states a fact others will trust: manifests, version floors, lockfiles, generated artifacts, READMEs, and release notes.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
