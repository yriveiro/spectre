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
    "A check you have never seen fail proves nothing, so make it fail on purpose before you trust it. Load it when you write a test, a linter rule, a benchmark, or a scanner, and before you trust a suite that is green, before you compare two implementations, and before you report a number: accuracy, recall, speed, size, a regression count. Then find the oracle instead of arguing, and measure the population rather than the specimen. A number from three hand-picked cases is an anecdote with a decimal point, and a corpus nobody regenerates is a claim again. Reporting a number you did not measure is principle-verification, which owns the other half: a fact nobody checked is not a fact.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
