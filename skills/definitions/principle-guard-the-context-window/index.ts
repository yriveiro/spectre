import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const principleGuardTheContextWindow: Definition = {
  id: Skill.ID.make("principle-guard-the-context-window"),
  name: Skill.Name.make("principle-guard-the-context-window"),
  description:
    "The session cannot hold it all, so spend the context on purpose. Load it when the material is too big to hold at once: a file or a log with thousands of lines, a list of files too long to read one at a time, every file under a path, a dozen files at once, a command that returns megabytes, a tool output that dumped thousands of lines into the session, several files that only make sense read together, the whole repo before you touch anything, or a plan that needs a fan-out of reads. Walk a big file through in a subagent, keep its summary in the main thread, and say what the structure is, never the raw payload. The reader pays the same finite budget, which is what principle-laziness-protocol is about.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
