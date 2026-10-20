import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const principleProveItWorks: Definition = {
  id: Skill.ID.make("principle-prove-it-works"),
  name: Skill.Name.make("principle-prove-it-works"),
  description:
    "Verify every output against the real artifact directly, never against a proxy, a self-report, or a successful compile. Load it before you say a thing works: when the tests pass but nothing touched the real surface, when a tool says it wrote the output, when the build is green and you are tempted to stop there, when the binary built without errors but nobody has run it, or when a first time user would not know what to click. Check the output itself rather than the tool that wrote it: open the rendered page, run the built binary, read the file the user will actually open, exercise the path a stranger will take. A check that stands next to the artifact proves the stand-in, not the thing. Which claims you are entitled to make at all is principle-verification, and checking the artifact you actually ship is this one.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
