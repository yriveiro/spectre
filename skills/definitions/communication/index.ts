import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const communication: Definition = {
  id: Skill.ID.make("communication"),
  name: Skill.Name.make("communication"),
  description:
    "The answer is right and the message is not, because it is too long, too padded, or shaped wrong. Load it when the reader says it is too long or too much, when they ask for just the answer, no preamble, or a summary, when they ask you to summarize what you just changed, and whenever the work is done, stuck, or waiting on the reader and the next thing is a sentence rather than a command. The refactor is done? Tell them what to do next. The build is red and they cannot tell what causes it? Name the cause and the fix. They do not understand what you want changed? Ask one question instead of guessing. Give them the options and pick one for them. Then: lead with the next action, number multi-step work, say which step of how many, cut the tangent, make the win visible in a form they can try, give the options with a recommendation. Never for the work itself: running a procedure is a playbook and settling a judgement call is a principle. It stays on until the reader says stop communication mode or normal mode. The words inside a sentence are the grammar skill, and the state a reader holds across a whole response is principle-laziness-protocol.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
