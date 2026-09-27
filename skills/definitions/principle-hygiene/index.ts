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
 * Care, not obsession — see "What this principle is not".
 */
export const principleHygiene: Definition = {
  id: Skill.ID.make("principle-hygiene"),
  name: Skill.Name.make("principle-hygiene"),
  description:
    "The principle that small deferred details compound into a mess no one can afford to fix later. Use when refactoring code you are already inside, removing something that is no longer used, deciding whether a dependency should be bumped, or finishing a change: leave what you touched cleaner than you found it, without expanding the change to prove it.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
