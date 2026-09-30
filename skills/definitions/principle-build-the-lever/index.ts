import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const principleBuildTheLever: Definition = {
  id: Skill.ID.make("principle-build-the-lever"),
  name: Skill.Name.make("principle-build-the-lever"),
  description:
    "Build the rerunnable thing instead of working by hand. Load it when the work touches more than a couple of sites, when you will run the same pass twice, or when you catch yourself making the same edit by hand in file after file. Write the codemod, the script, the generator, or the delegated skill, then run it, and keep it in the diff so the next pass costs nothing. A touch-up to the code you are already editing is principle-hygiene, and a lesson that must survive beyond one run belongs in structure under principle-encode-lessons-in-structure.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
