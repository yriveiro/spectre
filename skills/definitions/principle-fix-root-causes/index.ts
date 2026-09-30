import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const principleFixRootCauses: Definition = {
  id: Skill.ID.make("principle-fix-root-causes"),
  name: Skill.Name.make("principle-fix-root-causes"),
  description:
    "Trace every symptom to its root cause and fix it there, never with a guard or a workaround. Load it when you hold a candidate patch and must decide whether it ends the cause or only silences the report: a guard at the crash site, a default for the bad value, a retry around the flake. Reproduce first, then ask why until the answer is a defect you can point at, and treat a workaround that needs a paragraph of comment to justify as proof the code is wrong. Reproducing the failure first is principle-verification, and deciding which layer the fix belongs in is principle-boundary-discipline.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
