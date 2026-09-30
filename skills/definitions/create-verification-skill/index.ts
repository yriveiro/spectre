import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const createVerificationSkill: Definition = {
  id: Skill.ID.make("create-verification-skill"),
  name: Skill.Name.make("create-verification-skill"),
  description:
    "Build the proof a project is missing: a skill that starts the real app, uses a feature the way a user would, captures what happened, and tears down what it started. Reach for it when a repo has a test suite but no way to show the app itself works, so every claim about behaviour is reasoning rather than a captured run, which is a web UI nobody has clicked, a CLI nobody has driven, or a service whose response nobody has read. The output is a skill plus a feature map, both written for an agent that has never seen the app and is reading cold, mid-task. You call it. Nothing in this set calls it for you.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
