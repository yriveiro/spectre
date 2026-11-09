import type { Tool } from "@opencode/schema/tool";
import type { Block, Surfaces } from "./block";

const normalize = (name: string) => name.replace(/[^a-zA-Z0-9_-]/g, "_");

/**
 * The name the host uses for a tool. Kept in step with `effectiveName` in the
 * host's `packages/core/src/tool/runtime.ts`: a namespace flattens dots to
 * underscores, then joins the tool name with one underscore.
 */
export const effectiveToolName = (tool: Pick<Tool.Info, "name" | "options">): string =>
  tool.options?.namespace === undefined
    ? normalize(tool.name)
    : `${tool.options.namespace.replaceAll(".", "_")}_${normalize(tool.name)}`;

/** The surfaces a block actually registered, as the host names them. */
export type RecordedSurfaces = Surfaces;

const compare = <T extends string>(
  label: string,
  declared: readonly T[],
  actual: readonly T[],
): string[] => {
  const missing = declared.filter((id) => !actual.includes(id));
  const extra = actual.filter((id) => !declared.includes(id));
  return [
    ...(missing.length > 0 ? [`declared ${label} never registered: ${missing.join(", ")}`] : []),
    ...(extra.length > 0 ? [`registered ${label} never declared: ${extra.join(", ")}`] : []),
  ];
};

/** Why a block's declaration and its registration disagree. Empty means they agree. */
export const surfaceProblems = (block: Block, recorded: RecordedSurfaces): string[] => {
  return [
    ...compare("tools", block.surfaces.tools, recorded.tools),
    ...compare("skills", block.surfaces.skills, recorded.skills),
    ...compare("commands", block.surfaces.commands, recorded.commands),
    ...compare("agents", block.surfaces.agents, recorded.agents),
    ...compare("hooks", block.surfaces.hooks, recorded.hooks),
  ].map((problem) => `${block.id}: ${problem}`);
};
