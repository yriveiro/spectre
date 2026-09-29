import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

/**
 * The discipline of verifying every output against the real artifact directly.
 *
 * A proxy, a self-report, or a successful compile is not the thing. The test is
 * to check the real thing: open the rendered page, run the built binary, read
 * the artifact the user will actually touch. Its sibling principle-verification
 * owns never asserting more than has been checked; this leaf owns checking the
 * real artifact instead of a stand-in.
 */
export const principleProveItWorks: Definition = {
  id: Skill.ID.make("principle-prove-it-works"),
  name: Skill.Name.make("principle-prove-it-works"),
  description:
    "Verify every output against the real artifact directly, never against a proxy, a self-report, or a successful compile. Load it before you say a thing works: when the tests pass but nothing touched the real surface, when a tool reports its own success, when the build is green and you are tempted to stop there. Open the rendered page, run the built binary, read the file the user will actually open, exercise the path a stranger will take. A check that stands next to the artifact proves the stand-in, not the thing. Which claims you are entitled to make at all is principle-verification, and checking the artifact you actually ship is this one.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
