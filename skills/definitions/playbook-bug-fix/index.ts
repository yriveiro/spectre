import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

/** Why this is registered and not indexed: `skills/FOR_AGENTS.md`, rule 3. */
export const playbookBugFix: Definition = {
  id: Skill.ID.make("playbook-bug-fix"),
  name: Skill.Name.make("playbook-bug-fix"),
  description:
    "Own a defect from the first reproduction to a commit carrying the failing run and the fix, ruling hypotheses out one at a time until one mechanism survives on runtime evidence. Reach for it when something is broken in a way you have not yet explained: a crash, a wrong value, an intermittent failure, a test that passed yesterday. `tdd` owns the order of operations once a failing test exists; this owns the hunt, the fix and the proof, and that test is one phase of it. Work that adds a capability rather than correcting one is `playbook-feature`.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
