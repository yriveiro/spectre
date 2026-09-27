import type { Plugin } from "@opencode/plugin/effect";
import { Effect } from "effect";
import { spectre } from "./definitions/spectre";
import { sicko } from "./definitions/sicko";

const definitions = [spectre, sicko];

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
