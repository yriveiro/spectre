import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const playbookAuthoringASkill: Definition = {
  id: Skill.ID.make("playbook-authoring-a-skill"),
  name: Skill.Name.make("playbook-authoring-a-skill"),
  description:
    "Write or cut down a SKILL.md without changing what it is for. Reach for it when a leaf has grown past the decision it was meant to inform, or when a procedure you have run three times is not written down anywhere. It forces a pass whose only job is deletion, moves the reason next to the rule it explains, and sends the surviving text through the prose check. Not for deciding what a skill should say, which is the call you make before you open the file. You call it. Nothing in this set calls it for you.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
