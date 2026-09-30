import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const principleRedesignFromFirstPrinciples: Definition = {
  id: Skill.ID.make("principle-redesign-from-first-principles"),
  name: Skill.Name.make("principle-redesign-from-first-principles"),
  description:
    "Integrate a new requirement by redesigning as though it had been foundational from day one, rather than bolting it on beside what exists. Load it when a requirement arrives that the current shape never anticipated, when the plan starts with a flag, a special case, or a parallel path, or when the honest summary of the change is the old design plus an exception. Ask what you would build if you were writing this from scratch with this requirement in hand, then move the code toward that shape and let the old one dissolve. A bolt-on charges rent on every later change. Keeping the addition small by deleting first is principle-laziness-protocol, and naming the domain shape the redesign lands in is principle-model-the-domain.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
