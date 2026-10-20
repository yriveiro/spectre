import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const principleBuildTheLever: Definition = {
  id: Skill.ID.make("principle-build-the-lever"),
  name: Skill.Name.make("principle-build-the-lever"),
  description:
    "Load it when the work touches more than a couple of sites, when twelve modules carry the same bug, when you have to change the same call across thirty places, when you will run the same pass twice, when another team will need the same change next quarter, or when you catch yourself making the same edit by hand in file after file. Do it once instead of editing each one: build the rerunnable thing, a codemod, a script, a generator, or a delegated skill, then run it, and keep it in the diff so the next pass costs nothing. A touch-up to the code you are already editing is principle-hygiene, and a lesson that must survive beyond one run belongs in structure under principle-encode-lessons-in-structure.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
