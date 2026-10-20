import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const principleLazinessProtocol: Definition = {
  id: Skill.ID.make("principle-laziness-protocol"),
  name: Skill.Name.make("principle-laziness-protocol"),
  description:
    "Make the code easy to follow, and refuse to add to it. Load it when something is hard to follow, impossible to trace, or a pain to read, when you are asked where a value comes from, where this value get set, or what can change it, when the internals are a mess under a clean surface, when a function does too much, when you want this refactored to be cleaner, when a class, helper, or wrapper has one caller and only forwards and you wonder whether to collapse, flatten, or inline it, when you are tempted to extract a service class or add an abstraction for a single call site, and before you accept a task that says thread a flag through five layers. Ask two questions: cut the layer that hides nothing, keep state as narrow as a local, derive a value rather than synchronize it, and name the invariant once. Then the moment before: a refactor starts by looking for what to remove, and a signal you were told to thread is a design question. A boundary that hides a real decision stays, because that boundary is load reduction. Where a check belongs is principle-boundary-discipline, and accumulated concessions are principle-hygiene.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
