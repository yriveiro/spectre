import type { Plugin } from "@opencode/plugin/effect";
// From the subpath rather than the barrel: the barrel re-exports `Command`, which is the
// schema namespace holding `Command.Info`, and not the plugin's `CommandDefinition`.
import type { CommandDefinition } from "@opencode/plugin/effect/command";
import { join } from "node:path";
import { Effect } from "effect";

/**
 * One command definition, for the shape every command here shares.
 *
 * A command cannot call a tool: `CommandDefinition.execute` returns `Effect<void>`, so its only
 * move is to hand the session a prompt and let the model act on it. Every definition below
 * does that with the same four lines, so they are written once here and a definition supplies
 * only what differs: its name, its description, and the folder holding its `prompt.md`.
 *
 * The deterministic half of each command therefore belongs in a tool rather than here. `/pr`
 * composes nothing because `tools.spectre.pr` already did it, and a command that composed the
 * title itself would reintroduce the improvisation the tool exists to remove.
 *
 * `directory` is the definition's own folder, so `import.meta.dir` is the caller's to pass.
 * `skills/definitions/definition.ts` reaches a body the same way, and for the same reason: a
 * shared module cannot read the `import.meta` of the file that calls it.
 *
 * `$ARGUMENTS` is the host's config-command feature (`config/plugin/command.ts`), not the plugin
 * API, so anything the user typed is appended rather than substituted.
 */
const PROMPT = "prompt.md";

export const promptCommand = (
  ctx: Pick<Plugin.Context, "session">,
  directory: string,
  spec: { readonly name: string; readonly description: string },
): CommandDefinition => ({
  name: spec.name,
  description: spec.description,
  execute: (input) =>
    Effect.gen(function* () {
      const text = yield* Effect.tryPromise({
        try: () => Bun.file(join(directory, PROMPT)).text(),
        catch: (cause) =>
          new Error(`Cannot read the /${spec.name} prompt at ${PROMPT}: ${cause}`),
      }).pipe(Effect.orDie);
      const said = input.prompt.text.trim();
      yield* ctx.session.prompt({
        ...input.prompt,
        sessionID: input.sessionID,
        text: said === "" ? text : `${text}\n\nThe user added: ${said}`,
        delivery: input.delivery,
      });
    }).pipe(Effect.asVoid),
});