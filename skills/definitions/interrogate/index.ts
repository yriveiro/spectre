import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const interrogate: Definition = {
  id: Skill.ID.make("interrogate"),
  name: Skill.Name.make("interrogate"),
  description:
    "Put one diff or one design in front of several reviewers on different models and let them try to break it, then sort what comes back into act on, consider, and noise. Reach for it when the work is finished and you want it torn apart rather than agreed with: a diff about to open as a pull request, a migration plan, a design somebody is about to spend two weeks on. You call it. Nothing in this set calls it for you.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
