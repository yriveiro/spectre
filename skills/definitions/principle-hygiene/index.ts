import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

/**
 * The discipline of not leaving small things small.
 *
 * Split out of a file named for this principle that spent its length verifying
 * claims instead. The verification half is the principle-verification skill next
 * to this one. What lives here is upkeep: clean while you refactor, delete what
 * nothing reaches, and move a dependency when moving it is safe.
 *
 * Care, not obsession. See "What this principle is not".
 */
export const principleHygiene: Definition = {
  id: Skill.ID.make("principle-hygiene"),
  name: Skill.Name.make("principle-hygiene"),
  description:
    "Leave what you touched cleaner than you found it. Load it when you are already inside code you are editing anyway and you notice dead code, an unused export, a stale comment, a leftover flag, a duplicated block, or a dependency sitting on an old version that is still inside its range. Delete what nothing reaches, and take the safe bump while the checks that prove it are already in your hand. Hygiene is not finishing a change: that is principle-verification, and a skill that claims to do both cannot be trusted to do either.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
