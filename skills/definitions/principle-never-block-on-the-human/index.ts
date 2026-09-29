import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

/**
 * The discipline of proceeding on reversible work and presenting results.
 *
 * Confirmation is for irreversible actions: force-push, deploy, deletion, and
 * anything a customer reads. Everything else is reversible, and blocking on a
 * human for reversible work trades their attention for nothing. Do the work,
 * show what was done, and let correction replace permission.
 */
export const principleNeverBlockOnTheHuman: Definition = {
  id: Skill.ID.make("principle-never-block-on-the-human"),
  name: Skill.Name.make("principle-never-block-on-the-human"),
  description:
    "Proceed on reversible work and present the result; ask first only when the action cannot be undone. Load it when you are tempted to ask whether to continue, which approach to take among safe options, or for permission to do work that a diff can show and a revert can undo. Reversible means proceed without blocking: edits, refactors, drafts, probes, and anything reviewable. Irreversible means confirm: force-push, deploy, deletion, and anything a customer reads. A question that costs the human more attention than the mistake would cost to fix is a question you should not have asked. Whether a claim about the work holds is principle-verification, which owns what you check after you act.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
