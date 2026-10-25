import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const solidjsBestPractices: Definition = {
  id: Skill.ID.make("solidjs-best-practices"),
  name: Skill.Name.make("solidjs-best-practices"),
  description:
    "Reach for it while writing, reviewing or migrating SolidJS code: a signal or memo that does not update, a prop that freezes, an effect that fetches or writes state, a store setter that takes a path, `<For>` or `<Index>`, context, a SolidStart route, server function or hydration mismatch, or a Solid 1.x to 2.0 migration. It detects whether the project runs stable `solid-js` 1.9, the 2.0 release candidate, or SolidStart 1/2 (which still runs Solid 1), then gives the API for that exact version, the anti-patterns it punishes, and the checks that prove the change. Do not use it for React, Vue or Svelte. You call it. Nothing in this set calls it for you.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
