import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const canvas: Definition = {
  id: Skill.ID.make("canvas"),
  name: Skill.Name.make("canvas"),
  description:
    '"Make me a page that shows this", "turn this idea into something I can open and come back to", "show me what that workflow would look like as a UI". Load it when the reader asks for a visual artifact that keeps its identity: a run report or findings page, a designed concept or workflow mock, a single figure with its takeaway. Pick the kind the question needs — report for prose with diagrams, page for a designed document, diagram for one figure — then publish it with tools.spectre.canvas and report the artifact id and relative URL, and when they ask for changes update that same artifact in place instead of publishing a second copy. A request to review a pull request visually is pr-canvas, which owns PR identity, evidence, and the review layout; this skill never names a PR number.',
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
