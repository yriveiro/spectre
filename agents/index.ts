import type { Plugin } from "@opencode/plugin/effect";
import { Effect } from "effect";
import { spectre } from "./spectre";

/** Every agent this plugin defines, applied in this order. */
const definitions = [spectre];

/**
 * Apply the definitions to OpenCode's agent registry.
 *
 * `update` creates an agent that does not exist yet, which is how a plugin adds
 * one: the editor exposes no `add`. Its callback is synchronous, so the
 * definitions are resolved before it runs.
 */
export const update = (ctx: Pick<Plugin.Context, "agent">) =>
  Effect.gen(function* () {
    yield* ctx.agent.transform((editor) => {
      for (const definition of definitions) {
        editor.update(definition.id, (agent) => {
          const { permissions, ...overrides } = definition;

          Object.assign(agent, overrides);

          if (permissions !== undefined) agent.permissions.push(...permissions);
        });
      }
    });

    yield* Effect.logInfo("Registered agents", {
      agents: definitions.map((item) => item.id),
    });
  });
