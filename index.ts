import { Plugin } from "@opencode/plugin/effect";
import { Effect } from "effect";

/**
 * Spectre's OpenCode plugin entrypoint.
 *
 * OpenCode resolves this module as the package's server entrypoint and calls
 * `effect` once per project instance. Everything Spectre contributes to
 * OpenCode — skills, agents, tools, nested plugins, MCP servers — is registered
 * from inside that effect, through the domains on `ctx`.
 *
 * The id must be unique across every loaded plugin; OpenCode refuses to activate
 * two plugins that claim the same id.
 *
 * @see https://opencode.ai/v2/docs/build/plugins/effect/
 */
export default Plugin.define({
  id: "spectre",
  effect: (ctx) =>
    Effect.gen(function* () {
      yield* Effect.logInfo("Effect plugin loaded", {
        version: ctx.app.version,
      });
    }),
});
