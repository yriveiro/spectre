import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const typescriptBestPractices: Definition = {
  id: Skill.ID.make("typescript-best-practices"),
  name: Skill.Name.make("typescript-best-practices"),
  description:
    "The working TypeScript for the type discipline: a discriminant union, a branded primitive, `unknown` at the edge, a schema instead of a hand-rolled guard, the narrowing order, `satisfies`, `as const`, the `never` in the default arm, and the four reasons an `as` exists, each with the code that shows it. Reach for it while you are typing, when you need the form rather than the argument, when two legal spellings are both on the table, or when an existing cast has to come out and you need to know which of the four causes is in front of you. `principle-type-system-discipline` is the one to load when you are deciding whether to strengthen a type; this is the one to read when you are typing it. You call it. Nothing in this set calls it for you.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
