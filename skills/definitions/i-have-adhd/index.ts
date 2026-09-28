import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const iHaveAdhd: Definition = {
  id: Skill.ID.make("i-have-adhd"),
  name: Skill.Name.make("i-have-adhd"),
  description:
    'Shape output for a reader with ADHD: lead with the next action, number multi-step work, restate state across turns, suppress tangents, make wins visible, and say "I do not understand" instead of guessing. It also holds the prose pass, in rules 16 to 21: no em dashes, no -ing phrases, no unnamed sources, active voice, whole sentences. Load it with the i-have-adhd skill; it stays on until the reader says "stop adhd mode" or "normal mode".',
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
