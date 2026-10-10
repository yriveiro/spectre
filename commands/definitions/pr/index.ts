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
 * `import.meta.dir` is this module's own directory, so the prompt is the filename beside
 * this file and the path survives moving the tree. `skills/definitions/definition.ts`
 * reaches its body by `join` because it takes the directory as a parameter and cannot
 * read `import.meta.dir` itself.
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
 * `$ARGUMENTS` is the host's config-command feature (`config/plugin/command.ts`), not the
 * plugin API, so anything the user typed is appended rather than substituted.
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