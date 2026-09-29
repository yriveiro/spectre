import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

/**
 * Why this is registered and not indexed: `skills/FOR_AGENTS.md`, rule 3.
 *
 * A procedure with no moment a model should be trusted to start on its own,
 * because the reader is the input: the conventions it mines are the reader's
 * habits, and only the reader can say which of them are real.
 *
 * The mining pass runs on `git log`, the installed skills, and whatever files the
 * project already wrote its rules into. That evidence is thinner than a record
 * of what somebody actually typed, and the body says so rather than implying the
 * two are the same. The one rule that is not a visible convention has to be
 * asked for, so Phase C is not optional.
 */
export const automateMe: Definition = {
  id: Skill.ID.make("automate-me"),
  name: Skill.Name.make("automate-me"),
  description:
    "Draft a personal skill out of how the reader already works, so an agent follows their conventions without being asked each time. Reach for it when someone says automate me, or make a skill in my style, or turn my preferences into something an agent applies, and either no such skill exists or one exists and has drifted: the request is a person-shaped behaviour rather than a bug, a feature, or a design. It mines the commit history and the skills already installed, asks what the mining cannot see, and drops a rule the evidence does not carry. You call it. Nothing in this set calls it for you.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
