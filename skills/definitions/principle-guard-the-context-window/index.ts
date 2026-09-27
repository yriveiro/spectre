import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const principleGuardTheContextWindow: Definition = {
  id: Skill.ID.make("principle-guard-the-context-window"),
  name: Skill.Name.make("principle-guard-the-context-window"),
  description:
    "Apply when context is filling up: large outputs, long files, repeated reads, fan-out planning. Route bulk to subagents; keep summaries in the main thread, not raw payloads.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
