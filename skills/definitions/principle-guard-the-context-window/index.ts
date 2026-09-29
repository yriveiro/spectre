import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const principleGuardTheContextWindow: Definition = {
  id: Skill.ID.make("principle-guard-the-context-window"),
  name: Skill.Name.make("principle-guard-the-context-window"),
  description:
    "Spend context on purpose. Load it when the material is too big to hold at once: a file or a log with thousands of lines, a list of files too long to read one at a time, a command that returns megabytes, several files that only make sense read together, or a plan that needs a fan-out of reads. Read the bulk in a subagent and keep its summary in the main thread, never the raw payload. The reader pays the same finite budget, which is what principle-laziness-protocol is about.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
