import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

/**
 * The discipline of putting a recurring lesson where prose cannot decay.
 *
 * An instruction stated twice as prose will be stated a third time, or ignored
 * once. A lint rule, metadata, a runtime check, or a script says it every time
 * without being asked. Checking one claim once is principle-verification; the
 * rerunnable tool for a batch of work is principle-build-the-lever.
 */
export const principleEncodeLessonsInStructure: Definition = {
  id: Skill.ID.make("principle-encode-lessons-in-structure"),
  name: Skill.Name.make("principle-encode-lessons-in-structure"),
  description:
    "Say it in structure so you never say it again. Load it the second time you write the same instruction, the second time the same mistake returns, or the second time a review comment repeats one you already gave. Turn the prose into a lint rule, metadata, a runtime check, or a script, because prose is read once and structure is read every time. This principle states no falsifiable test, only a moment: the recurrence is the signal. Checking one claim once is principle-verification, and building the rerunnable tool for a batch of work is principle-build-the-lever.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
