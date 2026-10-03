import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const grammarSentence: Definition = {
  id: Skill.ID.make("grammar-sentence"),
  name: Skill.Name.make("grammar-sentence"),
  description:
    "One sentence, one claim, one named actor. Load it when a sentence is hard to read, too long, over 25 words, in the passive with nobody named, in the wrong tense, joined to a second instruction, or held together with a semicolon. Then: name the actor instead of writing the state is synchronized, keep the subject verb and article, split at one instruction per sentence, keep the hedge the author wrote, and replace the semicolon with a full stop. bun run lint/prose.ts checks the length, the tense, the voice and the semicolon. Passivity and the present perfect are advisory because both can carry a claim.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};