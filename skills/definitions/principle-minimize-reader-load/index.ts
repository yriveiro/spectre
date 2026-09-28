import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const principleMinimizeReaderLoad: Definition = {
  id: Skill.ID.make("principle-minimize-reader-load"),
  name: Skill.Name.make("principle-minimize-reader-load"),
  description:
    "The principle that maintainability is the work a reader must do, counted on two axes: the hops between the reader's question and the answer, and the state they must hold in their head. Use when reviewing code that is hard to trace, and before adding a layer, a wrapper, a field, or a module-level cache: collapse what only forwards, and do not collapse a boundary that hides a real decision.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
