import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const principleMinimizeReaderLoad: Definition = {
  id: Skill.ID.make("principle-minimize-reader-load"),
  name: Skill.Name.make("principle-minimize-reader-load"),
  description:
    "Maintainability is reader load on two independent axes: hops to trace and state to hold. Cut both. Load it when code is hard to follow, when you cannot answer where a value comes from or what can change it, or when a helper with one caller only forwards and you wonder whether to collapse it. The test is timed: a new reader answers both questions in under thirty seconds. Laziness is about the work and this is about the reading, so refusing the addition before it exists is principle-laziness-protocol, and where a check belongs is principle-boundary-discipline.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
