import type { Plugin } from "@opencode/plugin/effect";
import { Effect } from "effect";
import { sicko } from "./definitions/sicko";
import { spectre } from "./definitions/spectre";

const definitions = [spectre, sicko];

/** The only agents model routing may name. Read from the same list that registers them. */
export const agentIds = definitions.map((one) => one.id);

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
