import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const maintainVerificationSkill: Definition = {
  id: Skill.ID.make("maintain-verification-skill"),
  name: Skill.Name.make("maintain-verification-skill"),
  description:
    "Correct a verification skill and its feature map that have drifted from the app, settling every claim with a live drive rather than a re-read. Reach for it on a periodic pass, or when a feature file describes a behaviour the app no longer has, or a harness step now fails for a reason nobody wrote down. One read-only reader per feature file, one live pass that drives every feature, and at most one change of proven corrections, ending in one of three named words: clean, changed, or blocked. You call it. Nothing in this set calls it for you.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
