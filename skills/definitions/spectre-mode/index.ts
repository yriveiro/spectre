import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const spectreMode: Definition = {
  id: Skill.ID.make("spectre-mode"),
  name: Skill.Name.make("spectre-mode"),
  description:
    "The hub skill for Spectre mode: ultra focus, assertive, and short, with the honest-gap contract, plus the inline index of the principle-* leaf skills to navigate to. Load this first when working as Spectre, or when the reader asks to turn Spectre mode on or off.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
