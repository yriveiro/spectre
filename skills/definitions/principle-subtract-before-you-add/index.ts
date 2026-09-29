import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

/**
 * The discipline of deleting before building.
 *
 * Reach for it at the start of any addition, when you are about to extend code
 * that already carries dead branches, unused flags, single-use wrappers, or
 * options nobody passes. Remove those first, run the checks, and build on the
 * simpler base. There is no question that proves you subtracted enough; the
 * moment is the test.
 */
export const principleSubtractBeforeYouAdd: Definition = {
  id: Skill.ID.make("principle-subtract-before-you-add"),
  name: Skill.Name.make("principle-subtract-before-you-add"),
  description:
    "Delete before you build. Load it at the start of any addition, when you are about to extend code that already carries dead branches, unused flags, single-use wrappers, or options nobody passes: remove those first, run the checks, and build on the simpler base, because new code on top of dead code inherits the dead code's weight. There is no test for how much you removed, so the moment is the test: subtraction is the first step, not a cleanup pass after. Deletion-first as reader-load discipline is principle-laziness-protocol; this leaf owns the builder's sequence, subtracting so the addition lands on cleared ground.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
