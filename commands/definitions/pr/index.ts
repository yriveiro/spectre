import { type Plugin, Skill } from "@opencode/plugin/effect";
import { promptCommand } from "../../definition";
import { collectPreflight } from "./preflight";

export const pr = (ctx: Pick<Plugin.Context, "session">) =>
  promptCommand(ctx, import.meta.dir, {
    name: "pr",
    description: "open a pull request for this branch",
    skills: [Skill.ID.make("playbook-opening-a-pr")],
    context: collectPreflight,
  });
