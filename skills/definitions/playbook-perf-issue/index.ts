import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const playbookPerfIssue: Definition = {
  id: Skill.ID.make("playbook-perf-issue"),
  name: Skill.Name.make("playbook-perf-issue"),
  description:
    "Own a measured slowdown from a baseline number to a second number, with every fix traced to the measurement that motivated it. Reach for it when something is too slow and the report is a number or a complaint rather than a diagnosis, or when a change is claimed to be faster and nobody has run it. `ripwire` is the instrument and its static counters are not a heat map; this owns when to reach for it, which of eight strategy families the signal points at, and how to read the delta. A profile you have not captured is not a claim you have earned.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
