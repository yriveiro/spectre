import type { Plugin } from "@opencode/plugin/effect";
import { promptCommand } from "../../definition";

/**
 * `/anatomy` is the sizing step, not the drawing.
 *
 * The figure is built by the session through the `anatomy` skill and `tools.spectre.anatomy`,
 * which is why nothing deterministic lives here.
 */
export const anatomy = (ctx: Pick<Plugin.Context, "session">) =>
  promptCommand(ctx, import.meta.dir, {
    name: "anatomy",
    description: "size an isometric figure and start it",
  });