import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const principleOutcomeOrientedExecution: Definition = {
  id: Skill.ID.make("principle-outcome-oriented-execution"),
  name: Skill.Name.make("principle-outcome-oriented-execution"),
  description:
    "Work you have already broken into commits, phases or steps, and the question is what the end of it looks like and how you know you are done. Load it when the work will not fit in one commit: a migration split across commits, a rewrite in phases, a branch where half the callers are migrated and you have to decide whether to land it, a change you have already broken into steps. Write the end state down before the first commit, in a form the final commit can be checked against, then decide which checks run at which boundary: a cheap scoped check on each commit, the full one where the plan claims something new. A partial state on the way is fine, because the next commit is written down. A partial state with no named end is the failure, and so is reaching the end without a check of its own. What to delete when the migration finishes is principle-migrate-callers-then-delete-legacy-apis. Whether a check can fail at all is principle-evidence.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
