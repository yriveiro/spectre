import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const ripwireFirst: Definition = {
  id: Skill.ID.make("ripwire-first"),
  name: Skill.Name.make("ripwire-first"),
  description:
    "The moment map, attached once on the first prompt of a session. One verb per moment: before you open a file, before you write a new symbol, after an edit, when you fan work out to agents, when you think the work is done, when you clean up a branch, when you doubt an answer. Load it when you are at one of those moments and a claim about the code has not been measured yet.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
