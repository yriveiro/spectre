import type { Plugin } from "@opencode/plugin/effect";
import { promptCommand } from "../../definition";

/**
 * `/wt` opens a worktree for a named unit of work, through `tools.spectre.worktrees`.
 *
 * The tool creates the directory beside the repository, branches it off trunk, reads the
 * result back, and moves this session into it. `git worktree add` cannot do that last part,
 * so the raw command makes the directory and leaves the work going on in the wrong tree.
 *
 * The typed name reaches the session as free text appended to this command's `prompt.md`,
 * because `promptCommand` hands the model a prompt and nothing else. The prompt reads the
 * name out of the `The user added:` line rather than out of a parameter, and `CommandDefinition`
 * carries no argument of its own to pass one through.
 */
export const wt = (ctx: Pick<Plugin.Context, "session">) =>
  promptCommand(ctx, import.meta.dir, {
    name: "wt",
    description: "open a worktree for a named unit of work, and move this session into it",
  });
