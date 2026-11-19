import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const spectreMode: Definition = {
  id: Skill.ID.make("spectre-mode"),
  name: Skill.Name.make("spectre-mode"),
  description:
    "The hub skill for Spectre mode: ultra focus, assertive, and short, with the honest-gap contract, non-negotiable worktree rule, and routing through the Spectre skill catalog and tools.spectre.skills. Load this first when working as Spectre, or when the reader asks to turn Spectre mode on or off.",
  autoinvoke: false,
  catalog: {
    tier: "hub",
    summary: "Core Spectre disposition, honest-gap contract, zero-comment rule, and non-negotiable worktree rule",
  },
  path: anchor(import.meta.dir),
};
