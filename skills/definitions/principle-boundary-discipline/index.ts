import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const principleBoundaryDiscipline: Definition = {
  id: Skill.ID.make("principle-boundary-discipline"),
  name: Skill.Name.make("principle-boundary-discipline"),
  description:
    "Validate where data enters the system and nowhere else: CLI arguments, config files, environment variables, request bodies and headers, file and socket reads, database rows, external API responses. Load it when you write validation, type narrowing, or error handling in a CLI handler, a config parser, an HTTP route, or any adapter to a framework, and when you are about to add a null check or a second parse below the entry point. Parse the raw input into a domain type at that edge, keep the logic in pure functions the shell calls, and delete the re-validation the edge already made.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
