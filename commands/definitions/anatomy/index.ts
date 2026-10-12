import { join } from "node:path";
import type { Plugin } from "@opencode/plugin/effect";
// From the subpath rather than the barrel: the barrel re-exports `Command`,
// which is the schema namespace holding `Command.Info`, and not the plugin's
// `CommandDefinition`.
import type { CommandDefinition } from "@opencode/plugin/effect/command";
import { Effect } from "effect";

/**
 * `/anatomy` is the sizing step, not the drawing.
 *
 * A command cannot call a tool: `CommandDefinition.execute` returns
 * `Effect<void>`, so its only move is to hand the session a prompt and let the
 * model act on it. The figure is built by the session through the `anatomy`
 * skill and `tools.spectre.anatomy`, which is why nothing deterministic lives
 * here.
 */
const PROMPT = "prompt.md";

const prompt = () =>
  Effect.tryPromise({
    try: () => Bun.file(join(import.meta.dir, PROMPT)).text(),
    catch: (cause) => new Error(`Cannot read the /anatomy prompt at ${PROMPT}: ${cause}`),
  }).pipe(Effect.orDie);

export const anatomy = (ctx: Pick<Plugin.Context, "session">): CommandDefinition => ({
  name: "anatomy",
  description: "size an isometric figure and start it",
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
