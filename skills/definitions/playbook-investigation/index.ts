import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

/** Why this is registered and not indexed: `skills/FOR_AGENTS.md`, rule 3. */
export const playbookInvestigation: Definition = {
  id: Skill.ID.make("playbook-investigation"),
  name: Skill.Name.make("playbook-investigation"),
  description:
    "Answer a question about this repository without changing it: read the code, git and the pull request bodies, then come back with an explanation someone can act on, or a recommendation with the tradeoffs written down. Reach for it when the question is still being chosen, or when someone asks 'are we sure' about something the tree already answers. `how` explains one subsystem; this is the whole read-only engagement around it, from framing the question to saying what the answer changes. A question that turns out to need a code change belongs to `playbook-bug-fix` or `playbook-feature`, not here.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
