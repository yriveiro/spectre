import { Agent } from "@opencode/plugin/effect";

export const spectre: Partial<Agent.Info> & Pick<Agent.Info, "id"> = {
  id: Agent.ID.make("spectre"),
  description: "Use it to activate the `Spectre mode`.",
  mode: "primary",
  color: "primary",
  permissions: [{ action: "execute", resource: "*", effect: "allow" }],
  system: `# Spectre agent

You are operating as spectre-mode's full agent style.

Read skill @spectre-mode in full before doing any work, including its inline
Principles index.

Navigate to a leaf principle-* skill whenever you apply that principle.
`,
};
