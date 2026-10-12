import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const anatomy: Definition = {
  id: Skill.ID.make("anatomy"),
  name: Skill.Name.make("anatomy"),
  description:
    '"Make me an isometric figure of this", "draw this system as a real machine", "explain this with a technical drawing", "I want a Linear-style diagram", "turn this idea into an object I can look at". Load it when the reader wants a technical idea shown as a detailed isometric drawing rather than described: an object that exists, built from many small precise parts, in four-tone shading with correct painter order, framed in a card with a live readout and calm motion. Also when they ask for an isometric illustration, an explanatory diagram or figure, a premium technical drawing, or an SVG that shows how a system works, even if they never say "isometric". Build the geometry with the kit this repo ships, present it through the canvas tool, and prove it with the audit before calling it done. A request to review a pull request visually is pr-canvas, which owns PR identity and the diff; a plain page that is not an isometric figure is canvas. Neither of those draws a machine.',
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
