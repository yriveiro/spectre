import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

/**
 * The discipline of fixing where the defect lives instead of where it reports.
 *
 * Applies to the candidate patch: you hold a change that would make the
 * symptom stop, and the question is whether it makes the cause stop too. A
 * guard at the crash site, a default for the bad value, a retry around the
 * flake each silence the report while the wrongness stays in place.
 *
 * The test is reproduction followed by honest asking. Reproduce the failure
 * somewhere safe, then ask why until the answer is a defect you can point at
 * rather than a condition you can guard against. A workaround that needs a
 * paragraph of comment to justify means the code is wrong.
 */
export const principleFixRootCauses: Definition = {
  id: Skill.ID.make("principle-fix-root-causes"),
  name: Skill.Name.make("principle-fix-root-causes"),
  description:
    "Trace every symptom to its root cause and fix it there, never with a guard or a workaround. Load it when you hold a candidate patch and must decide whether it ends the cause or only silences the report: a guard at the crash site, a default for the bad value, a retry around the flake. Reproduce first, then ask why until the answer is a defect you can point at, and treat a workaround that needs a paragraph of comment to justify as proof the code is wrong. Reproducing the failure first is principle-verification, and deciding which layer the fix belongs in is principle-boundary-discipline.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
