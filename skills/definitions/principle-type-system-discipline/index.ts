import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const principleTypeSystemDiscipline: Definition = {
  id: Skill.ID.make("principle-type-system-discipline"),
  name: Skill.Name.make("principle-type-system-discipline"),
  description:
    "Let the checker prove what tests can only sample. Load it when a string is sometimes an id and sometimes a name, when a config object's fields agree only by convention, when a new variant compiles without touching every match, and at every boundary where outside data enters: parse once into the narrow type the inside uses, brand primitives like UserId and OrderId so they cannot cross, and match exhaustively so the next variant breaks the build instead of slipping through. Three questions quote the test: can you write one sentence explaining when this field combination is valid, can a UserId pass where an OrderId belongs, does adding a variant break the build. The language-agnostic claim is principle-make-states-unrepresentable; this leaf owns the concrete forms.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
