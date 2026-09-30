import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const playbookHillclimb: Definition = {
  id: Skill.ID.make("playbook-hillclimb"),
  name: Skill.Name.make("playbook-hillclimb"),
  description:
    "Drive one measurable thing toward a number, one change per measurement, keeping only what the measurement says is a win. Reach for it when a cost is high enough to keep paying for: a first paint that takes 400ms on a large document, a cold start that regressed, an import that dominates the bundle, a throughput ceiling a team keeps losing to. Not for a one-off fix, which is a bug rather than a loop, and not for 'make this cleaner', which has no metric to climb. Run `playbook-trace-forensics` or `playbook-runtime-forensics` first when nobody yet knows where the cost lives, because a hillclimb against the wrong target is a loop with a deadline and no progress.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
