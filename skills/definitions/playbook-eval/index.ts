import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

/** Why this is registered and not indexed: `skills/FOR_AGENTS.md`, rule 3. */
export const playbookEval: Definition = {
  id: Skill.ID.make("playbook-eval"),
  name: Skill.Name.make("playbook-eval"),
  description:
    "Run a blinded comparison of two candidate skills and find out which one to keep. Reach for it when you have a rewritten skill or a changed description and the question is which variant a real prompt routes to, and you cannot tell from reading it. It builds a sanitized environment, gives each candidate the same organic prompt, grades the chain from the files it actually read, and puts a judge in front of the result. Not for measuring this repository's own routing across its whole set. You call it. Nothing in this set calls it for you.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
