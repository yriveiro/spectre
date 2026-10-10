import type { Plugin } from "@opencode/plugin/effect";
// From the subpath rather than the barrel: the barrel re-exports `Command`, which is the
// schema namespace holding `Command.Info`, and not the plugin's `CommandDefinition`. The
// barrel exporting a same-named thing from a different layer is why this import is long.
import type { CommandDefinition } from "@opencode/plugin/effect/command";
import { join } from "node:path";
import { Effect } from "effect";

/**
 * One command, registered from the plugin rather than shipped as markdown a user has to
 * install. The host resolves markdown commands from `{command,commands}/**\/*.md` under a
 * config entry (`packages/core/src/config/plugin/command.ts` at `v2.0.26`), and that
 * loader is not reachable from a plugin. `ctx.command.transform` is, and the host's own
 * `init` and `review` commands register through exactly this path
 * (`packages/core/src/plugin/command.ts` at the same tag). So this is the native
 * mechanism, not a substitute for one.
 */
const PROMPT = "prompt.md";

/**
 * The prompt lives in a file rather than a template literal for the same reason a skill's
 * body does: it is prose a maintainer reads and edits, and a multi-paragraph instruction
 * inside a `.ts` file reads as part of the code. `import.meta.dir` is this module's own
 * directory, so the path is the filename beside it and survives moving the tree. It is
 * the same anchor `skills/definitions/definition.ts` uses, which joins instead because a
 * skill's body sits one level above its declaration.
 */
const prompt = () =>
  Effect.tryPromise({
    try: () => Bun.file(join(import.meta.dir, PROMPT)).text(),
    catch: (cause) => new Error(`Cannot read the /pr prompt at ${PROMPT}: ${cause}`),
  }).pipe(Effect.orDie);

/**
 * A command cannot call a tool: `CommandDefinition.execute` returns `Effect<void>`, so the
 * only thing it can do is hand the session a prompt and let the model act on it. That is
 * why `/pr` does not open the pull request itself, and why the deterministic part stays
 * in `tools.spectre.pr`. A command that composed the title here would reintroduce the
 * improvisation the tool exists to remove.
 *
 * Anything the user typed after `/pr` is appended, so `note text` rides along instead of
 * being dropped. It cannot be a template parameter, because there is no argument here to
 * parameterize: `input.prompt.text` is whatever the composer holds, and a command
 * registered this way has no `$ARGUMENTS` substitution of its own. That is the host's
 * config-command feature (`config/plugin/command.ts`), not the plugin API.
 */
export const pr = (ctx: Pick<Plugin.Context, "session">): CommandDefinition => ({
  name: "pr",
  description: "open a pull request for this branch",
  execute: (input) =>
    Effect.gen(function* () {
      const text = yield* prompt();
      const said = input.prompt.text.trim();
      yield* ctx.session.prompt({
        ...input.prompt,
        sessionID: input.sessionID,
        text: said === "" ? text : `${text}\n\nThe user added: ${said}`,
        delivery: input.delivery,
      });
    }).pipe(Effect.asVoid),
});