import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

/**
 * Why this is registered and not indexed: `skills/FOR_AGENTS.md`, rule 3.
 *
 * Distinct from `arena`, and the difference is the direction of the fan-out. An
 * arena has one task and several answers, and what it produces is a synthesis,
 * so the picking is the work. An interrogation already has one artifact and hands
 * that same artifact to several reviewers, so the finding is the work and
 * nothing is built from the answers.
 */
export const interrogate: Definition = {
  id: Skill.ID.make("interrogate"),
  name: Skill.Name.make("interrogate"),
  description:
    "Put one diff or one design in front of several reviewers on different models and let them try to break it, then sort what comes back into act on, consider, and noise. Reach for it when the work is finished and you want it torn apart rather than agreed with: a diff about to open as a pull request, a migration plan, a design somebody is about to spend two weeks on. You call it. Nothing in this set calls it for you.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
