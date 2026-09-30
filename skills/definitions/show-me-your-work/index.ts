import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const showMeYourWork: Definition = {
  id: Skill.ID.make("show-me-your-work"),
  name: Skill.Name.make("show-me-your-work"),
  description:
    "Keep a decision trail a person can check later: one tab separated row per decision, carrying the reason, a pointer as evidence, and the outcome. Reach for it when the work runs long enough that you will not remember why you made the call, or long enough that somebody else has to review it without you in the room: a migration, a multi phase change, a run you are handing over to be approved. Git history records what changed, this records what you rejected on the way there. You call it. Nothing in this set calls it for you.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
