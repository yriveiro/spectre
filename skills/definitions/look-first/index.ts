import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const lookFirst: Definition = {
  id: Skill.ID.make("look-first"),
  name: Skill.Name.make("look-first"),
  description:
    "Where to look first in code you have not read yet. Load it when you are landing cold — a new repo, a subsystem someone else owns, a bug in a file you have never opened — and need the first file to open. Start at the top of `ripwire --rank-by=churn`: the files that move the most are where the current meaning lives, because the last change is the most recent statement of intent. The ranking is a place to start and not an oracle — it says what moved, not what matters — so read the first file before asserting anything about it. Not who knows the file; the history tool's `ownership` answers that.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
