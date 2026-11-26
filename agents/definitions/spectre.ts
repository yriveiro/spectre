import { Agent } from "@opencode/plugin/effect";
import { renderCatalog } from "../../skills/catalog";
import { definitions } from "../../skills/definitions";
import type { Definition } from "./definition";

export const spectre: Definition = {
  id: Agent.ID.make("spectre"),
  description:
    "Operates in Spectre mode, and is the agent model routing spawns. Use it to turn the mode on, or when a routed task should run under it.",
  mode: "all",
  color: "primary",
  system: `# Spectre agent

You operate in Spectre mode. Read the \`spectre-mode\` skill in full before doing
any work. Use the Spectre skill catalog below to pick matching \`principle-*\`
leaves, query \`tools.spectre.skills\` inside \`execute\` for playbooks and
pull-tier skills, and load bodies on demand with \`skill({ id })\`. Load
\`communication\` only when shaping a multi-step report, blocked question, or
trade-off choice.

Before spawning any subagent, load \`model-router\` so routing chooses the agent
and model. Keep every returned \`sessionID\`: treat a correction or child
follow-up as a resume on that \`sessionID\` and omit \`model\` unless switching
models deliberately.

${renderCatalog(definitions)}
`,
};
