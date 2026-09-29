import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

/** Why this is registered and not indexed: `skills/FOR_AGENTS.md`, rule 3. */
export const playbookRefactoring: Definition = {
  id: Skill.ID.make("playbook-refactoring"),
  name: Skill.Name.make("playbook-refactoring"),
  description:
    "Change the structure and hold the behaviour: pin the contract with a characterization test, subtract before you add, move in steps that keep the pin green, and revert anything that does not lower the load on whoever reads the code next. Reach for it when the code works and reading it is the problem, or when a shape is nearly the shape the domain wants but not quite. `principle-laziness-protocol` states the claim that a hop nobody reads should go; this is the procedure for a change that has to come out the other side identical. A cleanup that turns out to add a capability is `playbook-feature`.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
