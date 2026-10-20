import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const principleSubtractBeforeYouAdd: Definition = {
  id: Skill.ID.make("principle-subtract-before-you-add"),
  name: Skill.Name.make("principle-subtract-before-you-add"),
  description:
    "About to add code, and the ground you are adding it to already carries what it does not need. Load it at the start of any addition, before you write the new code: when the module you are about to extend still holds unused flags, branches nobody takes, or wrappers that only forward, and the new option arrives while the old ones are still there, remove those first and build on the simpler base, because new code on top of old weight inherits it. The deletions come before the addition, and they are checked on their own, and that order is the claim. Deletion-first as reader-load discipline is principle-laziness-protocol; this leaf owns the builder's sequence.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
