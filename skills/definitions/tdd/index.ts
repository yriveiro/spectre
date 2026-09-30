import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const tdd: Definition = {
  id: Skill.ID.make("tdd"),
  name: Skill.Name.make("tdd"),
  description:
    "Make the bug executable as a failing test before you touch the code, then fix it and watch it go green. Reach for it when a defect has a cheap local test target and you would otherwise be the only thing standing between it and the next person: a wrong return value, a bad edge in a pure function, a regression somebody reported on a real input. The order is the whole point, since a test that has only ever passed has not been shown to catch anything. You call it. Nothing in this set calls it for you.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
