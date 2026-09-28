import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

/**
 * The discipline of obtaining the proof, not merely of claiming it.
 *
 * Verification says a fact nobody checked is not a fact; that claim half is the
 * principle-verification skill next to this one. What lives here is the other
 * half, which covers how the check is obtained and how you know the check itself
 * works. Find
 * the oracle instead of arguing, prove a check can fail, and measure the
 * population rather than the specimen.
 */
export const principleEvidence: Definition = {
  id: Skill.ID.make("principle-evidence"),
  name: Skill.Name.make("principle-evidence"),
  description:
    "The principle that a claim is only as good as the evidence behind it and the evidence must be able to fail. Use when choosing between two implementations, when writing or trusting a test suite, a linter rule, a benchmark or a scanner, and before reporting any number: accuracy, recall, speed, size, or regression count.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
