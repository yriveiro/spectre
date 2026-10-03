import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const codeHygiene: Definition = {
  id: Skill.ID.make("code-hygiene"),
  name: Skill.Name.make("code-hygiene"),
  description:
    "The hygiene pass for comments in code, and it runs the sicko subagent to judge them. Spawns sicko to report deletable comments, vetoes what it got wrong, then fixes the survivors at the root cause and offers to encode any claimed constraint as a real check. Requires Code Mode. Use when asked to strip comments from code, remove narration or commented-out code from a diff, delete a comment that only restates the name, or act on a comment audit. Not about prose in a document: that is the grammar skill, and not about the shape of a reply, which is communication.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
