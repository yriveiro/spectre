import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

/**
 * Why this is registered and not indexed: `skills/FOR_AGENTS.md`, rule 3.
 *
 * A procedure for a project that is not this one, and the second half of the
 * pair whose first half is `create-verification-skill`. It corrects rather than
 * builds, and the two facts that make it its own skill are that every claim it
 * ships was proven by a live drive rather than settled by re-reading the source,
 * and that a run ends in one of three named words.
 *
 * The edit scope is deliberate and load-bearing: a run may not touch product
 * code, because that is how a product regression gets documented as a fix.
 */
export const maintainVerificationSkill: Definition = {
  id: Skill.ID.make("maintain-verification-skill"),
  name: Skill.Name.make("maintain-verification-skill"),
  description:
    "Correct a verification skill and its feature map that have drifted from the app, settling every claim with a live drive rather than a re-read. Reach for it on a periodic pass, or when a feature file describes a behaviour the app no longer has, or a harness step now fails for a reason nobody wrote down. One read-only reader per feature file, one live pass that drives every feature, and at most one change of proven corrections, ending in one of three named words: clean, changed, or blocked. You call it. Nothing in this set calls it for you.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
