import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

/**
 * Why this is registered and not indexed: `skills/FOR_AGENTS.md`, rule 3.
 *
 * `tools.spectre.history` already reads commit messages and blame, and it answers
 * "why is this line shaped like this". What it cannot answer is why one option
 * won. Git records the change that landed; a decision log records the ones that
 * did not, which is the half a reviewer needs and the half git has no column for.
 */
export const showMeYourWork: Definition = {
  id: Skill.ID.make("show-me-your-work"),
  name: Skill.Name.make("show-me-your-work"),
  description:
    "Keep a decision trail a person can check later: one tab separated row per decision, carrying the reason, a pointer as evidence, and the outcome. Reach for it when the work runs long enough that you will not remember why you made the call, or long enough that somebody else has to review it without you in the room: a migration, a multi phase change, a run you are handing over to be approved. Git history records what changed, this records what you rejected on the way there. You call it. Nothing in this set calls it for you.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
