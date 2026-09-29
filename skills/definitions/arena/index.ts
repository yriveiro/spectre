import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

/** Why this is registered and not indexed: `skills/FOR_AGENTS.md`, rule 3. */
export const arena: Definition = {
  id: Skill.ID.make("arena"),
  name: Skill.Name.make("arena"),
  description:
    "Put the same task to several models at once, read all of the answers, take the strongest as the base, and fold in the best of the rest. Reach for it when one attempt would lock in the wrong shape and you would rather see three answers than argue for one: a design you have to commit to, a refactor with more than one honest layout, or a document whose structure is the hard part. You call it. Nothing in this set calls it for you.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
