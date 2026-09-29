import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

/**
 * Why this is registered and not indexed: `skills/FOR_AGENTS.md`, rule 3.
 *
 * The one procedure that designs its own decision path rather than handing a
 * decision to a sibling. The trail it keeps is the git trail, and
 * `tools.spectre.history` reads it back.
 */
export const figureItOut: Definition = {
  id: Skill.ID.make("figure-it-out"),
  name: Skill.Name.make("figure-it-out"),
  description:
    "Write the playbook yourself when no bundled procedure fits, and run the task under it. Reach for it when the work is big enough that the sequence of steps is itself the hard part: a migration across every caller, a change nobody can review in one sitting, or a task where `spectre-mode` routed you to `none` and gave reasons. It produces a written workflow, one verified unit at a time, and a commit trail somebody can audit afterwards. You call it. Nothing in this set calls it for you.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
