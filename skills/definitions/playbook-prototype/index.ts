import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

/** Why this is registered and not indexed: `skills/FOR_AGENTS.md`, rule 3. */
export const playbookPrototype: Definition = {
  id: Skill.ID.make("playbook-prototype"),
  name: Skill.Name.make("playbook-prototype"),
  description:
    "Build the thing you are going to throw away, in order to make one decision, in a scratch directory outside the project with no tests and no abstractions. Reach for it when the decision is visual or empirical and the code is not the deliverable: which layout, which interaction, which density, which of two approaches is actually faster. `principle-exhaust-the-design-space` states when a decision with no precedent needs competitors built; this is how you run the experiment once that has already fired. Once the direction is chosen, the real build is `playbook-feature`.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
