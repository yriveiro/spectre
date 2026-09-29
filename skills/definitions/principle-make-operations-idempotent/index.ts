import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const principleMakeOperationsIdempotent: Definition = {
  id: Skill.ID.make("principle-make-operations-idempotent"),
  name: Skill.Name.make("principle-make-operations-idempotent"),
  description:
    "State-mutating operations must converge: the end state is a function of the desired state and what already exists, not of how many times the operation has run. Load it when you write something that writes state and can be re-entered after a restart, a resume, or a retry: a command, a lifecycle step, a migration, a cleanup script, a scheduled job, a respawning worker, or a lock. Ask three questions first: what happens on the second run, what happens if the last one was interrupted partway, does re-execution land in the same place. If the answer depends on what was left behind, the operation is missing a reconciliation step. Delete by content rather than by creation order, and give every lock a staleness rule so a dead holder cannot block forever.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
