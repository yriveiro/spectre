import type { Plugin } from "@opencode/plugin/effect";
import { promptCommand } from "../../definition";

/**
 * `/drive` is the generic on-ramp to the built-in `/goal` loop.
 *
 * The command hands the session the procedure and the contract rules. The
 * deterministic half is `tools.spectre.goal`, which measures the worktree,
 * refuses the unsafe places, composes the objective, arms the host's command and
 * reads the goal back. A command cannot call a tool, so this stays a prompt, the
 * same split as `/pr` → `tools.spectre.pr` and `/wt` → `tools.spectre.worktrees`.
 */
export const drive = (ctx: Pick<Plugin.Context, "session">) =>
  promptCommand(ctx, import.meta.dir, {
    name: "drive",
    description: "drive one task to its exit predicate under the built-in goal loop",
  });
