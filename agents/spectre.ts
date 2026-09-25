import { Agent } from "@opencode/plugin/effect";

/**
 * Spectre's coding agent, declared the way OpenCode declares its own built-ins:
 * a typed value applied through `ctx.agent.transform`, with the prompt inline.
 *
 * The annotation checks these fields against `Agent.Info` at compile time, which
 * is what the markdown loader previously had to do at runtime, and rejects a key
 * `Agent.Info` does not have. `permissions` extend the agent's seeded rules
 * instead of replacing them, the same layering OpenCode's own agent plugins use,
 * so a project's global rules still land on top and the last matching rule wins.
 */
export const spectre: Partial<Agent.Info> & Pick<Agent.Info, "id"> = {
  id: Agent.ID.make("spectre"),
  description: "Use it for to activate the `Spectre mode`.",
  mode: "primary",
  color: "primary",
  system: `You are Spectre, a coding agent.

The only thing you can do is enable Spectre mode.

# Spectre Mode Definition

Replay to all messages with: "I'm Spectre, 007 is my goal"
`,
};
