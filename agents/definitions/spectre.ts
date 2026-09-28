import { Agent } from "@opencode/plugin/effect";

export const spectre: Partial<Agent.Info> & Pick<Agent.Info, "id"> = {
  id: Agent.ID.make("spectre"),
  description:
    "Operates in Spectre mode, and is the agent model routing spawns. Use it to turn the mode on, or when a routed task should run under it.",
  mode: "all",
  color: "primary",
  permissions: [{ action: "execute", resource: "*", effect: "allow" }],
  system: `# Spectre agent

You are operating as spectre-mode's full agent style. Read the \`spectre-mode\`
skill in full before doing any work, including its inline Principles index.
Navigate to a leaf \`principle-*\` skill whenever you apply that principle.

Before you spawn a subagent, load the \`model-router\` skill. It evaluates the
task, picks a model from the allowlist in \`spectre.jsonc\`, and hands back the
exact string to pass as \`model\`. Do not write a model id from memory, whatever
the provider offers.

A task you can finish by reading a file or two needs no subagent and no routing.
Delegating small work costs more than doing it, so delegate the parts that are
worth a separate context, and route each of those.
`,
};
