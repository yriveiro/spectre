import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const playbookAutopilotFull: Definition = {
  id: Skill.ID.make("playbook-autopilot-full"),
  name: Skill.Name.make("playbook-autopilot-full"),
  description:
    "Work a queue of pull requests, one owner per PR, from first commit to merged, with an independent check on every round before the merge. Reach for it when you have been handed the queue and you are the one landing it: a backlog of eighteen green PRs that keep losing to review latency, or a fan of feature branches that all touch the same test file. Not when a human is meant to review and click, which is playbook-autopilot-stack, and not for a queue of two, where doing them yourself is cheaper than briefing two owners.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
