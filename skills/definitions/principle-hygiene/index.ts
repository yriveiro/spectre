import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const principleHygiene: Definition = {
  id: Skill.ID.make("principle-hygiene"),
  name: Skill.Name.make("principle-hygiene"),
  description:
    "You are inside code you are editing anyway, and something in it does not earn its place. Load it when you are already in a file and you notice a function nobody calls, an unused export, an unused helper kept just in case, a dead branch, a stale comment, a duplicated block, or a dependency on an old version that is still inside its range: remove what nothing reaches, update the docs that name it, and take the safe bump while the checks that prove it are already in your hand. Count what the change removed as well as what it added, and do not walk past what is already broken while you are standing on it. This leaf owns the callers-free half. A path with a replacement that is still live is principle-migrate-callers-then-delete-legacy-apis, and removal before addition as a decision to make first is principle-laziness-protocol. Hygiene is not finishing a change: that is principle-verification, and a skill that claims to do both cannot be trusted to do either.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
