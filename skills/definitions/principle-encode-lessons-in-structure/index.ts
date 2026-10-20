import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const principleEncodeLessonsInStructure: Definition = {
  id: Skill.ID.make("principle-encode-lessons-in-structure"),
  name: Skill.Name.make("principle-encode-lessons-in-structure"),
  description:
    "Load it the second time you write the same instruction, the second time the same mistake comes back, or the second time a review comment repeats one you already gave. The same warning for the third time, the same defect every week, the same guidance for every new hire, the same review comment on every one of my changes: put the rule where a tool can enforce it, a lint rule, a check, a metadata field, or a script, so nobody has to say it again. Prose is read once and forgotten, structure is read every time. Checking one claim once is principle-verification, and building the tool for a batch of work is principle-build-the-lever.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
