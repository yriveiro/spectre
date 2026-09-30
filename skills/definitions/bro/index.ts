import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const bro: Definition = {
  id: Skill.ID.make("bro"),
  name: Skill.Name.make("bro"),
  description:
    "Restate your last message in plain words, the way one person explains something to another. Reach for it when a reply did not land: when you lost the thread, when a sentence carried a term you had to look up, or when you want the previous answer again without the jargon. It rewrites the last turn, cuts every term the reader would have had to look up, keeps every fact including the caveats, and answers with the restatement and nothing else. You call it. Nothing in this set calls it for you.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
