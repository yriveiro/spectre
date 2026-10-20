import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const principleTestForTruth: Definition = {
  id: Skill.ID.make("principle-test-for-truth"),
  name: Skill.Name.make("principle-test-for-truth"),
  description:
    "Name the defect each test catches, say what the suite costs, and never edit a test to reach a green run. Load it when a suite is green and nobody can say what it covers, when somebody asks which edge cases are worth a test, when the tests are slow, numerous, or take minutes to run, when a red needs triaging, or when a check gets skipped to make the run pass. It owns which tests a project keeps, what each one catches, what it costs, and how a failure nobody can fix gets reported. The shape of one assertion is principle-test-behavior-not-implementation, and what you may claim from a passing run is principle-verification.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
