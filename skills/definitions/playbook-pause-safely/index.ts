import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const playbookPauseSafely: Definition = {
  id: Skill.ID.make("playbook-pause-safely"),
  name: Skill.Name.make("playbook-pause-safely"),
  description:
    "Stop work at a clean boundary and leave something a cold-start session can pick up: uncommitted edits as one `wip:` commit, and a written note carrying the intent, the state, and the first action. Reach for it when you are being asked to stop, when you are running out of room, or when a long job has to be handed to whoever picks it up next. Not on 'keep going', 'going to bed, keep going', or 'don't stop' — on those you keep going, because this procedure is a stop and there is no pause in it. There is no agent transcript to write the note into here, so the note goes in the commit body and in a file beside the tree, which is what actually survives.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
