import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const principleOutcomeOrientedExecution: Definition = {
  id: Skill.ID.make("principle-outcome-oriented-execution"),
  name: Skill.Name.make("principle-outcome-oriented-execution"),
  description:
    "A plan that spans commits names the state it converges on, and every commit is measured against that state rather than against its own comfort. Load it when the work will not fit in one commit: a staged migration, a rewrite of a subsystem, a change you have already broken into steps, or a branch where part of the work is done. Write the end state down before the first commit, in a form the last commit can be checked against, then decide which checks run at which boundary: a cheap scoped check per commit, the full one at the boundary where the plan claims something new. A partial state on the way is fine and normal, because the next commit is written down. A partial state with no named end is the failure, and so is reaching the end without a check of its own. What to delete when the migration finishes is principle-migrate-callers-then-delete-legacy-apis. Whether a check can fail at all is principle-evidence.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
