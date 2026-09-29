import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

/** Why this is registered and not indexed: `skills/FOR_AGENTS.md`, rule 3. */
export const playbookAutopilotStack: Definition = {
  id: Skill.ID.make("playbook-autopilot-stack"),
  name: Skill.Name.make("playbook-autopilot-stack"),
  description:
    "Build the queue and land none of it: one owner per pull request, one verification round each, and every verified PR appended to a single stacked base branch for a person to review bottom-up and merge. Reach for it when the work is sequenced or coupled so the PRs cannot land out of order, or when the landings are somebody else's to make — a six-PR schema change, a migration whose later steps only compile after earlier ones land. Not when you have been given merge authority and the PRs are independent, which is playbook-autopilot-full. The procedure stops one step before the merge on purpose.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
