import { Plugin } from "@opencode/plugin/effect";
import { Effect } from "effect";
import * as agents from "./agents";
import * as skills from "./skills";
import * as tools from "./tools";

/**
 * Spectre's OpenCode plugin entrypoint.
 *
 * OpenCode resolves this module as the package's server entrypoint and calls
 * `effect` once per project instance. Everything Spectre contributes to
 * OpenCode — skills, agents, tools, nested plugins, MCP servers — is registered
 * from inside that effect, through the domains on `ctx`.
 *
 * A duplicate id is not fatal: the first registration wins and the later one is
 * marked failed, so two copies load and the installed one silently takes the id.
 *
 * Nothing here reads `spectre.jsonc`. Model routing is a tool, called when a model
 * is about to be chosen, so a config mistake is reported to whoever was about to
 * route instead of stopping a session that had nothing to do with it.
 *
 * @see https://opencode.ai/v2/docs/build/plugins/effect/
 */
export default Plugin.define({
  id: "yriveiro.spectre",
  effect: (ctx) =>
    Effect.gen(function* () {
      yield* Effect.logInfo("Effect plugin loaded", {
        version: ctx.app.version,
      });
      yield* agents.update(ctx);
      yield* skills.update(ctx);
      yield* tools.update(ctx);
    }),
});
