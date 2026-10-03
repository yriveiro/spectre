import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const grammarText: Definition = {
  id: Skill.ID.make("grammar-text"),
  name: Skill.Name.make("grammar-text"),
  description:
    "The shape of a document, for a file a reader navigates rather than reads once. Load it when writing a README, a SKILL.md, a design note, a runbook, or anything with headings and lists: one topic per paragraph, a list for a sequence, a colon before the list, one marker style, no procedural item mixed with a descriptive one, a heading that says what is under it because a heading is also a grep target, a hyphen where two words are one unit, and at most five items visible at a time. Nothing here has an instrument: whether the shape worked is a person reading the page.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};