import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const playbookVisualParity: Definition = {
  id: Skill.ID.make("playbook-visual-parity"),
  name: Skill.Name.make("playbook-visual-parity"),
  description:
    "Move a component to a new implementation and prove it looks the same, by diffing screenshots against a baseline you captured first and never touched. Reach for it when the pixels are part of the contract: porting a design system, replacing a component library, reproducing a reference implementation, or keeping a UI stable across a rewrite. Not for a change that is allowed to look different, where a screenshot diff fights the actual goal, and not for layout work with no baseline yet, which is design work rather than parity. Every component is compared against its own captured baseline, and a nonzero diff is a failure to investigate rather than a threshold to tune.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
