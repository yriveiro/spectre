import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const prCanvas: Definition = {
  id: Skill.ID.make("pr-canvas"),
  name: Skill.Name.make("pr-canvas"),
  description:
    '"Review PR 42 visually", "make me a page that walks through this pull request", "I just opened a PR, show it to me". Load it when the reader names a pull request, or an explicit local base and head, and wants a reviewer-facing page they can open: what changed, which requirement each hunk answers, and the side-by-side diff behind every claim. A direct request naming the PR is consent to build it; after you create a PR yourself, offer once with Generate canvas and Skip and take a skip, a dismissal, or silence as no. An idea that is not a pull request and has no diff is canvas, which owns the standalone page and never names a PR number.',
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
