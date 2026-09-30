import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const playbookTraceForensics: Definition = {
  id: Skill.ID.make("playbook-trace-forensics"),
  name: Skill.Name.make("playbook-trace-forensics"),
  description:
    "Read a capture that already exists — a cpuprofile, a heap snapshot, a trace, a spindump — and reduce it to a cause with a file and a line behind it. Reach for it when something handed you the artefact: a CI profile from a slow job, a crash report with a stack, a `.cpuprofile` the browser offered to save. Not for a process that is still misbehaving and can be watched, which is `playbook-runtime-forensics`, and not for a flake you have to reproduce before you have anything at all. The artefact is a fixed dataset, so every number you quote has to be reproducible by re-reading the file, and a finding with no symbol mapping in it is not yet a cause.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
