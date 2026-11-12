import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const diagram: Definition = {
  id: Skill.ID.make("diagram"),
  name: Skill.Name.make("diagram"),
  description:
    '"Chart this", "plot the numbers", "graph this data", "make me a diagram of how the values compare", "show me the shape of this distribution". Load it when the reader has data and wants it drawn: a comparison, a trend over time, a distribution, a relationship between two variables, a part-to-whole, a stage diagram. Pick the mark the question needs before drawing anything, write one Mermaid source for structure or a d3 page for statistics, then publish it with tools.spectre.canvas and report the artifact id and relative URL. Pele renders Mermaid to static SVG at publish time, a statistical chart references vendor/d3.min.js with the bundle attached by the tool, and every label and caption is checked against the prose standard. A pull request shown as a page is pr-canvas; an idea or a mock UI with no data behind it is canvas.',
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
