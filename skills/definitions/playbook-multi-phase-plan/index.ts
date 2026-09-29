import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

/** Why this is registered and not indexed: `skills/FOR_AGENTS.md`, rule 3. */
export const playbookMultiPhasePlan: Definition = {
  id: Skill.ID.make("playbook-multi-phase-plan"),
  name: Skill.Name.make("playbook-multi-phase-plan"),
  description:
    "Write the plan for a change too big for one pull request, and stop there. Reach for it when the work spans several pull requests, has an order they must land in, or has an open question only a run can answer: settle the questions with prototypes, explore in subagents, and produce a checklist an owner runs box by box with a verification block per pull request. Not for one or two files with an obvious approach, where a plan is ceremony. You call it. Nothing in this set calls it for you.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
