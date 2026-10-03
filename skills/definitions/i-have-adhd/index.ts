import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const iHaveAdhd: Definition = {
  id: Skill.ID.make("i-have-adhd"),
  name: Skill.Name.make("i-have-adhd"),
  description:
    'The answer is right and the response is not, because it is too long, too padded, or shaped wrong. Load it when the reader says it is too long or too much, when they ask for just the answer, no preamble, or a summary, and before you send anything that opens with context, restates the plan, or closes by asking whether they need anything else. Then: lead with the next action, number multi-step work, say which step of how many you are on, cut the tangent, make the win visible in a form they can try, and say "I do not understand" instead of guessing. It stays on until the reader says "stop adhd mode" or "normal mode". The words inside a sentence are the grammar skill, and the state a reader holds across a whole response is principle-laziness-protocol.',
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
