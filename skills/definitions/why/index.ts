import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const why: Definition = {
  id: Skill.ID.make("why"),
  name: Skill.Name.make("why"),
  description:
    "Recover the reason a piece of code is shaped the way it is, from the commit history, and say plainly when the history does not contain the answer. Reach for it when you are about to change something you do not recognise: a guard against a condition that cannot happen, a constant with a value nobody would pick, a shape that is more convoluted than the problem needs, or a comment that says what rather than why. `how` explains the code to you; this explains it to the person who wrote it, or admits nobody wrote down why. You call it. Nothing in this set calls it for you.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
