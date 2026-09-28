import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const noComments: Definition = {
  id: Skill.ID.make("no-comments"),
  name: Skill.Name.make("no-comments"),
  description:
    "Delete the comments that should not exist. Spawns the sicko subagent to report deletable comments, vetoes what it got wrong, then fixes the survivors at the root cause and offers to encode any claimed constraint as a real check. Requires Code Mode. Use when asked to strip comments, remove narration or commented-out code, or clean up a diff.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
