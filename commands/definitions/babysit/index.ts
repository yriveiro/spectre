import type { Plugin } from "@opencode/plugin/effect";
import { promptCommand } from "../../definition";

/**
 * `/babysit` is `/drive` for a pull-request stack.
 *
 * It arms the same built-in `/goal` loop through the same tool. The difference is
 * the objective the tool receives: the predicate is a `tools.spectre.stack`
 * verdict and the check is that one call, so the loop is the host's loop and the
 * review procedure stays `playbook-babysit`.
 */
export const babysit = (ctx: Pick<Plugin.Context, "session">) =>
  promptCommand(ctx, import.meta.dir, {
    name: "babysit",
    description: "drive a pull-request stack to merge-ready under the built-in goal loop",
  });
