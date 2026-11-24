import type { Plugin } from "@opencode/plugin/tui";
import { createSignal } from "solid-js";
import { show } from "../render.ts";
import { toolsBlade } from "./blade.tsx";
import { toolsSidebar } from "./sidebar.tsx";
import { toolUsage } from "./usage.ts";

/** The `session.panel` name the blade answers to. The sidebar box opens it by click. */
export const PANEL = "spectre.tools";

const VIEW = "tools.view";

/**
 * Registers both tool-usage surfaces: the compact sidebar box (call counts
 * only) and the session panel it opens (calls plus tokens by type). The panel
 * is a host slot, so its layout and input scope belong to the host; this only
 * claims the content.
 */
export const registerTools = (context: Plugin.Context): (() => void) => {
  const [view, setView] = context.storage.store(VIEW, {
    initial: { open: true },
  });
  const [open, setOpen] = createSignal(view.open ?? true);

  const usage = (sessionID: string) => {
    const boundary = context.data.session.get(sessionID)?.revert?.messageID;
    return toolUsage(context.data.session.message.list(sessionID), boundary);
  };

  const stopSidebar = context.ui.slot({
    append: "sidebar.content",
    render: (input) =>
      toolsSidebar({
        theme: context.theme,
        usage: () => usage(input.sessionID),
        open,
        onToggle: () => {
          const next = !open();
          setOpen(next);
          void setView((held) => {
            held.open = next;
          }).catch(() => undefined);
        },
        onOpenPanel: () => {
          context.ui.panel.open(PANEL);
        },
      }),
  });

  const stopPanel = context.ui.slot({
    append: "session.panel",
    render: (panel) =>
      show(
        () => panel.name === PANEL,
        () =>
          toolsBlade({
            context,
            panel,
          }),
      ),
  });

  // The panel opens by clicking the sidebar box, not by a command: the
  // blocks are the way in, so no palette entry claims it.

  return () => {
    stopPanel();
    stopSidebar();
  };
};
