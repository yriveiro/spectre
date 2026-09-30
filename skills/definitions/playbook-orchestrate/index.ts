import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const playbookOrchestrate: Definition = {
  id: Skill.ID.make("playbook-orchestrate"),
  name: Skill.Name.make("playbook-orchestrate"),
  description:
    "Run a programme that outlasts any single session: a migration across two hundred call sites, a pull request stack that has to stay green from the bottom up, a backlog you would otherwise re-prompt every morning. Reach for it when you are the only one who will still be holding the objective in a week, and when the state has to live in files because every run that picks it up starts cold with none of this conversation. Not for a single task driven to a checkable exit, which is playbook-autonomous-run, and not for one decision with two honest answers, which is arena.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
