import type { Plugin } from "@opencode/plugin/tui";
import { createSignal } from "solid-js";
import { show } from "../render.ts";
import { subagentsBlade } from "./blade.tsx";
import { profileRouting } from "./routing.ts";
import { subagentsSidebar } from "./sidebar.tsx";
import { type ProfileRouting, sessionUsage } from "./usage.ts";

/** The `session.panel` name the blade answers to, and the slash command that opens it. */
export const PANEL = "spectre.subagents";

const VIEW = "subagents.view";

/**
 * Registers both profile surfaces: the compact sidebar box (one line per
 * routing profile with usage) and the session panel it opens (the parent's
 * per-model usage, per-profile tokens and cost, and the selected profile's
 * runs in a table below the totals). The panel is a host slot, so its
 * layout and input scope belong to the host; this only claims the content.
 */
export const registerSubagents = (context: Plugin.Context): (() => void) => {
  const [view, setView] = context.storage.store(VIEW, {
    initial: { open: true },
  });
  const [open, setOpen] = createSignal(view.open ?? true);

  // Sort order survives hot reloads but not a TUI restart: it is a viewing
  // choice, not a durable preference.
  const [sort, setSort] = context.storage.memory<{ by: "tokens" | "cost" }>("subagents.sort", {
    initial: { by: "tokens" as const },
  });

  // The routing table is read from disk per directory and cached; the version
  // signal redraws whichever surface already rendered a cached answer. A
  // failed read is not cached: it retries on the next render. A config edit
  // in the routing page appears when the model catalogue changes or the TUI
  // restarts — the page keeps no cross-feature revision signal at v2.3.0.
  const cache = new Map<string, ReadonlyArray<ProfileRouting>>();
  const counts = new Map<string, number>();
  const pending = new Set<string>();
  const [version, setVersion] = createSignal(0);

  const profiles = (sessionID: string): ReadonlyArray<ProfileRouting> => {
    void version();
    const session = context.data.session.get(sessionID);
    const directory = session?.location.directory ?? context.data.location.default().directory;
    // The session's own catalogue, not the default location's: a session in
    // another worktree must never resolve against another directory's
    // models.
    const models = context.data.location.model.list(session?.location) ?? [];
    if (models.length === 0) {
      void context.data.location.model.sync(session?.location).catch(() => undefined);
    }
    if (counts.get(directory) !== models.length && !pending.has(directory)) {
      pending.add(directory);
      void profileRouting(directory, models)
        .then((list) => {
          pending.delete(directory);
          counts.set(directory, models.length);
          cache.set(directory, list);
          setVersion((at) => at + 1);
        })
        .catch(() => {
          pending.delete(directory);
        });
    }
    return cache.get(directory) ?? [];
  };

  const report = (sessionID: string) =>
    sessionUsage({
      // The family root, not the current session: the panel opened on a
      // child must still partition the whole family, root included.
      rootID: context.data.session.root(sessionID),
      family: (id) => context.data.session.family(id),
      get: (id) => context.data.session.get(id),
      status: (id) => context.data.session.status(id),
      messages: (id) => context.data.session.message.list(id),
      profiles: profiles(sessionID),
    });

  const stopSidebar = context.ui.slot({
    append: "sidebar.content",
    render: (input) =>
      subagentsSidebar({
        theme: context.theme,
        report: () => report(input.sessionID),
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
          subagentsBlade({
            context,
            panel,
            profiles: () => profiles(panel.sessionID),
            sortBy: () => sort.by,
            onSortToggle: () =>
              setSort((draft) => {
                draft.by = draft.by === "tokens" ? "cost" : "tokens";
              }),
          }),
      ),
  });

  context.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: "spectre.subagents.open",
        title: "Session breakdown",
        description: "Open the session panel with per-agent, per-profile tokens, cost, and per-run stats",
        group: "Spectre",
        palette: true as const,
        slash: { name: "breakdown" } as const,
        run: () => {
          const route = context.ui.router.current();
          if (route.type !== "session") {
            context.ui.toast.show({
              title: "Session breakdown",
              message: "Usage is per session; open a session first.",
              variant: "info",
            });
            return;
          }
          const current = context.ui.panel.current();
          if (
            current !== undefined &&
            current.name === PANEL &&
            current.sessionID === route.sessionID
          ) {
            context.ui.panel.close();
            return;
          }
          context.ui.panel.open(PANEL);
        },
      },
    ],
  }));

  return () => {
    stopPanel();
    stopSidebar();
  };
};
