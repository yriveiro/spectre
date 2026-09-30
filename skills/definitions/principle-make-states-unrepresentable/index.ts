import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const principleMakeStatesUnrepresentable: Definition = {
  id: Skill.ID.make("principle-make-states-unrepresentable"),
  name: Skill.Name.make("principle-make-states-unrepresentable"),
  description:
    "Two fields that only make sense together should be one value, not two. Load it when you are adding a boolean, an optional field, or a flag and a second one has to stay in sync with the first; when a function takes three optional arguments and callers pass them in any order; when you are choosing a union against an interface with optional fields; when two values are the same primitive type but mean different things, like a user id and an order id; and when you are about to write an any, a cast, or a this-should-never-happen throw. The check is one sentence: if you can write a comment explaining when this combination of fields is valid, those fields do not belong in one type, and the answer is a union rather than a narrower check. Model the variants so adding one breaks the build instead of a call site, and derive the second value rather than synchronizing it. Parsing external data is principle-boundary-discipline, and whether extra indirection earns itself is principle-laziness-protocol.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
