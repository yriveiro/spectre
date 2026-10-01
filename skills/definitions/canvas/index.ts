import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const canvas: Definition = {
  id: Skill.ID.make("canvas"),
  name: Skill.Name.make("canvas"),
  description:
    '"Make me a page that shows this", "turn this idea into something I can open", "show me what that workflow would look like as a UI". Load it when the reader asks for a visual artifact they can open in a browser and keep coming back to: a concept page, a workflow mock, an analysis presented as an interface, a product idea drawn rather than described. Then build the standalone self-contained page with inline CSS and JavaScript and present it through the OS launcher, and when they ask for changes edit that same file in place instead of making a second copy. A request to review a pull request visually is pr-canvas, which owns PR identity, evidence, and the review layout; this skill never names a PR number.',
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
