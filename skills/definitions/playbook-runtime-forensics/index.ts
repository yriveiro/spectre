import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

/** Why this is registered and not indexed: `skills/FOR_AGENTS.md`, rule 3. */
export const playbookRuntimeForensics: Definition = {
  id: Skill.ID.make("playbook-runtime-forensics"),
  name: Skill.Name.make("playbook-runtime-forensics"),
  description:
    "Find the cause of a live problem by instrumenting the running process, and hand back a cited diagnosis rather than a fix. Reach for it when the process is doing something wrong right now and reading the source has already failed to explain it: a worker pegging a core, a server whose RSS climbs every hour, a UI that stutters on interaction. Not for a hang or a crash that already left you an artifact on disk, which is `playbook-trace-forensics`, and not for guessing at an improvement with nothing wrong, which is `playbook-hillclimb`. Every number this produces is a sample from the live process, so a finding that cannot be reproduced against that process stays a hypothesis.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
