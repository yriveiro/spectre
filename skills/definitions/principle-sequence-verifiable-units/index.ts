import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const principleSequenceVerifiableUnits: Definition = {
  id: Skill.ID.make("principle-sequence-verifiable-units"),
  name: Skill.Name.make("principle-sequence-verifiable-units"),
  description:
    "Cut work into small units that each end in a check. Load it when a task has more than one step, a migration, a refactor across files, a feature with setup plus behaviour plus cleanup, and bracket each unit before you start: a known-good state, one change, then the check, advancing only on green and stopping on red. A unit that cannot state its check is not a unit, so split it until it can. What checking honestly means is principle-verification; this leaf owns the ordering around it.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
