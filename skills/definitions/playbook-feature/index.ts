import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

/** Why this is registered and not indexed: `skills/FOR_AGENTS.md`, rule 3. */
export const playbookFeature: Definition = {
  id: Skill.ID.make("playbook-feature"),
  name: Skill.Name.make("playbook-feature"),
  description:
    "Own a new capability from the subsystem map to a shipped branch, settling the shape before code exists, then splitting the work and delegating the writing with a specific scope. Reach for it when the request is 'add X' and X has no implementation yet: an endpoint, a flag, a migration, a whole command. `architect` settles the types, the signatures and the module layout before any code exists; this is the whole lifecycle around that, through verification and the branch. A defect you cannot yet explain is `playbook-bug-fix`, and a layout you only need to imagine once is `playbook-prototype`.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
