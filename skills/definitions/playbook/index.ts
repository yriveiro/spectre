import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

/**
 * Why this is registered and not indexed: `skills/FOR_AGENTS.md`, rule 3.
 *
 * This is the one index the playbooks get, and it is a file of its own rather
 * than rows in `spectre-mode`. A playbook is a whole task shape, so an entry
 * per playbook in the hub would grow the file that already is the binding
 * constraint, and the hub's own rule says its index entry has to become one
 * line. One row in the hub, the selection table here.
 */
export const playbook: Definition = {
  id: Skill.ID.make("playbook"),
  name: Skill.Name.make("playbook"),
  description:
    "Pick the right procedure for the shape of task in front of you, from twenty-two of them, and say which one you picked before starting it. Reach for it when a request is big enough that the order of the steps matters: a bug, a feature, a refactor, something too slow, something to be fixed overnight, a stack of pull requests to land. Read it when a bare request could be done two honest ways, because the difference between picking the right procedure and the wrong one is most of the work. `spectre-mode` routes to principles; this routes to whole tasks. It calls them for you, which no other skill in this set does.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
