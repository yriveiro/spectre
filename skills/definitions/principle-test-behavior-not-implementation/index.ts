import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const principleTestBehaviorNotImplementation: Definition = {
  id: Skill.ID.make("principle-test-behavior-not-implementation"),
  name: Skill.Name.make("principle-test-behavior-not-implementation"),
  description:
    "A test calls the code the way its callers do and asserts a literal value, so it fails when the code is wrong rather than when the code changed shape. Load it when you write, edit, or keep a test, and before you trust a green suite. One check answers it: would the test still pass if every function it imports returned undefined? If yes, it observes no behavior, so rewrite the assertion against a concrete input and a literal expected value, or delete it. Five shapes always pass that mutation: a weak assertion like toBeDefined or not.toThrow, a mock assertion that only checks it was called, an expected value computed by calling the code under test, a hand-maintained constant or prompt string restated verbatim, and a fixture that asserts its own beforeEach data. For a constant, test the mechanism that reads it with one input instead of restating the value. For an absence, assert the presence on the other input in the same test. Keep a relation across table rows and a compile-time check in a .test-d.ts file; both fail the mutation for reasons unrelated to test quality.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
