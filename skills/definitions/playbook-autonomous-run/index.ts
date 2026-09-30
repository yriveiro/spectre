import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const playbookAutonomousRun: Definition = {
  id: Skill.ID.make("playbook-autonomous-run"),
  name: Skill.Name.make("playbook-autonomous-run"),
  description:
    "Drive one task to a checkable exit condition, one short run at a time, with the condition written where the next run can read it. Reach for it when the work is a single thread that needs several passes to come out right: a test suite that has to reach zero failures, a repro that has to stop reproducing, a handful of pull requests that have to end up merged. Not for work measured in days that needs a standing objective, which is playbook-orchestrate, and not at all if you cannot write the exit condition as something that can come out false.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
