import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const modelRouter: Definition = {
  id: Skill.ID.make("model-router"),
  name: Skill.Name.make("model-router"),
  description:
    "Read a task, then pick a model for it from the models spectre.jsonc allows and spawn a subagent on that. Load this before any subagent call, so the model string comes from the checked allowlist rather than from memory. Use whenever work is about to be delegated to a subagent, and when a task should be split so the mechanical part and the judgement part run on different models.",
  path: anchor(import.meta.dir),
};
