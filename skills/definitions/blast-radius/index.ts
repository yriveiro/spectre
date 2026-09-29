import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

/**
 * Why this is registered and not indexed: `skills/FOR_AGENTS.md`, rule 3.
 *
 * Distinct from `ripwire.impact` and `ripwire.edit_check`, which are the
 * instruments. Those two are deterministic and they answer the call-graph half
 * without being asked twice. This procedure is when to reach for them, how to
 * read what they say, and what they are blind to: the JSON an API returns, a
 * wire format, a column, a flag, code three hops downstream. It does not
 * reimplement either verb.
 */
export const blastRadius: Definition = {
  id: Skill.ID.make("blast-radius"),
  name: Skill.Name.make("blast-radius"),
  description:
    "Work out what a change breaks somewhere else before it lands, and prove the one fact it is safe because of by running the real code instead of writing it up. Reach for it when you are about to merge a diff you did not trace, or when somebody asks what changing a function, a config value or a data shape takes with it somewhere you did not touch. It is not a caller list, because the caller list is one command and ripwire.impact already has it. You call it. Nothing in this set calls it for you.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
