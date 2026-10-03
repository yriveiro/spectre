import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const grammar: Definition = {
  id: Skill.ID.make("grammar"),
  name: Skill.Name.make("grammar"),
  description:
    "The ASD-STE100 rules for how the text reads, plus the tells the standard does not cover. Load it when the writing is wrong and you cannot say which part is wrong: a sentence too long or hard to parse, nobody named as the actor, the wrong tense, a word bigger than the fact like utilize or leverage or seamless, one thing called the customer in one paragraph and the client in the next, a readme that is a wall of text, a heading that is just a noun, a list of fourteen items, or a semicolon holding two clauses together. Then: name the actor, use the plainest word and repeat it, keep the subject verb and article, split at one instruction per sentence, cut the semicolon, put the sequence in a list. bun run lint/prose.ts checks the semicolon, the phrasal verbs, the nominalizations, the marketing adjectives, the length and the passive voice. Passive voice and the present perfect are advisory because both can carry a claim.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};