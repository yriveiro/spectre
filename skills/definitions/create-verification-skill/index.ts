import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

/**
 * Why this is registered and not indexed: `skills/FOR_AGENTS.md`, rule 3.
 *
 * A procedure for a project that is not this one, so it writes into somebody
 * else's checkout rather than registering something here.
 *
 * The half of this port that changed most: the source wrote into a per-tool
 * directory that has no equivalent here, so the artefact is a directory skill
 * at `.opencode/skills/verify-<app>/` with the YAML frontmatter OpenCode needs
 * to load it at all. Its pair is `maintain-verification-skill`, the upkeep
 * loop for whatever this writes; the two are one idea at two moments and
 * neither should be read without the other named.
 */
export const createVerificationSkill: Definition = {
  id: Skill.ID.make("create-verification-skill"),
  name: Skill.Name.make("create-verification-skill"),
  description:
    "Build the proof a project is missing: a skill that starts the real app, uses a feature the way a user would, captures what happened, and tears down what it started. Reach for it when a repo has a test suite but no way to show the app itself works, so every claim about behaviour is reasoning rather than a captured run, which is a web UI nobody has clicked, a CLI nobody has driven, or a service whose response nobody has read. The output is a skill plus a feature map, both written for an agent that has never seen the app and is reading cold, mid-task. You call it. Nothing in this set calls it for you.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
