import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const diagram: Definition = {
  id: Skill.ID.make("diagram"),
  name: Skill.Name.make("diagram"),
  description:
    "\"Chart this\", \"plot the numbers\", \"graph this data\", \"make me a diagram of how the values compare\", \"show me the shape of this distribution\". Load it when the reader has data and wants it drawn: a comparison, a trend over time, a distribution, a relationship between two variables, a part-to-whole, a stage diagram. Pick the mark the question needs before drawing anything, vendor the pinned d3 bundle beside the page so it loads from the filesystem with no network, then keep the page minimal: one accent, no second value axis, no legend that repeats the axis, no decoration on data, and every label and caption checked against the prose standard. Present it through the canvas tool. A machine or a system drawn as a physical object is anatomy, which builds it from a geometry kit; a pull request shown as a page is pr-canvas; an idea or a mock UI with no data behind it is canvas.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
