import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const grammarWords: Definition = {
  id: Skill.ID.make("grammar-words"),
  name: Skill.Name.make("grammar-words"),
  description:
    "One word, one meaning, the plainest one available. Load it when you choose a word, name something, or notice one thing going by several names in the same document: use instead of utilize, one term instead of protagonist main character central figure, analyze instead of perform an analysis of, start instead of spin up. Also when a sentence sounds bigger than the fact, names a feeling instead of a mechanism, could appear unchanged in another project's docs, stacks nouns on each other, or uses boldface to repeat the line after it. Carries the ASD-STE100 word rules and the tells the standard does not cover.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};