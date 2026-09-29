import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

/**
 * The discipline of suspecting the shared belief when its fixes keep failing.
 *
 * Two or more fixes built on one premise, failing the same gate, are evidence
 * against the premise, not a request for a third fix. The neighbouring cases
 * belong elsewhere: a single failure is principle-verification, and a novel
 * decision with no precedent is principle-exhaust-the-design-space.
 */
export const principleAttackThePremise: Definition = {
  id: Skill.ID.make("principle-attack-the-premise"),
  name: Skill.Name.make("principle-attack-the-premise"),
  description:
    "Stop tuning fixes that share one failed belief. Load it when two or more fixes built on the same premise fail the same gate, when you are about to start the third attempt at a failure you have already seen twice, or when each new fix narrows to a parameter of the same idea. Write the premise down in one sentence, count the failures against it, and attack the sentence before writing another fix: negate it, replace it, or prove it from scratch. A single failure is principle-verification, reproduce and check before diagnosing, and a choice with no precedent at all is principle-exhaust-the-design-space.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
