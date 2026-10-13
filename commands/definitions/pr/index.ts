import type { Plugin } from "@opencode/plugin/effect";
import { promptCommand } from "../../definition";

/**
 * `/pr` opens the pull request for this branch.
 *
 * The deterministic half is `tools.spectre.pr`, which composes and lints the title and body.
 * What arrives here is the session half: hand the model the routine and let it call the tool.
 */
export const pr = (ctx: Pick<Plugin.Context, "session">) =>
  promptCommand(ctx, import.meta.dir, {
    name: "pr",
    description: "open a pull request for this branch",
  });