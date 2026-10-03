import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const communication: Definition = {
  id: Skill.ID.make("communication"),
  name: Skill.Name.make("communication"),
  description:
    "ASD-STE100 Simplified Technical English is how this set writes: one actor, one action, one claim per sentence, and the plainest available word. Load it for any English a person or a downstream model has to parse without asking you what you meant: a reply, an error message, a tool description, a commit body, a document, a report. It is not how you work, so no rule in it applies to a principle body, though the prose inside one is covered. It owns no rule: it states the standard, the scope, and the precedence rule where STE wins every contradiction, then routes to grammar-sentence, grammar-words and grammar-text. Reach for lint/prose.ts when you want the sentence and word rules checked rather than read.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};