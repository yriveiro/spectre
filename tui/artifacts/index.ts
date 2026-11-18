import type {
  Dialog,
  DialogSelectAction,
  DialogSelectOption,
  DialogSelectOptions,
  KeymapCommand,
  Toast,
} from "@opencode/plugin/tui/context";
import { type BrowserOpener, createBrowserOpener, type OpenMode, type OpenResult } from "./open.ts";
import {
  type ArtifactListResult,
  type ArtifactStore,
  type ArtifactSummary,
  type GalleryServer,
  startGalleryServer,
} from "./server.ts";

export {
  type BrowserOpener,
  type CommandResult,
  createBrowserOpener,
  type OpenerDeps,
  type OpenMode,
  type OpenResult,
  type RunCommandOptions,
  runCommand,
  systemBrowserCommand,
} from "./open.ts";
export {
  type ArtifactListResult,
  type ArtifactReadResult,
  type ArtifactStore,
  type ArtifactSummary,
  contentTypeFor,
  createRequestHandler,
  type GalleryServer,
  makeClientArtifactStore,
  normalizeSubpath,
  startGalleryServer,
} from "./server.ts";

export type ActiveLocationContext = {
  readonly directory: string;
  readonly sessionID?: string | undefined;
};

export type ArtifactsController = {
  readonly openModal: () => Promise<void>;
  readonly openGallery: () => Promise<void>;
  readonly dispose: () => void;
};

export type ArtifactDialog = Pick<Dialog, "clear"> & {
  readonly select: (
    options: DialogSelectOptions<ArtifactSummary>,
  ) => Promise<ArtifactSummary | undefined>;
};

export const formatRelativeTime = (updatedAt: number, now = Date.now()): string => {
  const seconds = Math.floor(Math.max(0, now - updatedAt) / 1_000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(updatedAt).toISOString().slice(0, 10);
};

const toSelectOption = (
  item: ArtifactSummary,
  now: number,
  activeSessionID?: string,
): DialogSelectOption<ArtifactSummary> => {
  const isCurrentSession = activeSessionID !== undefined && item.sessionID === activeSessionID;
  const showOtherSession =
    !isCurrentSession && item.sessionTitle !== undefined && item.sessionTitle.length > 0;
  const age = formatRelativeTime(item.updatedAt, now);
  const footerParts = [
    item.provider === "local" ? undefined : item.provider,
    isCurrentSession ? "current" : undefined,
    age,
  ].filter((part): part is string => part !== undefined);

  return {
    title: item.title,
    value: item,
    description: showOtherSession
      ? `${item.id} · ${item.sessionTitle} · ${item.entry}`
      : `${item.id} · ${item.entry}`,
    footer: footerParts.join(" · "),
  };
};

export const toDialogOptions = (
  items: ReadonlyArray<ArtifactSummary>,
  activeSessionID?: string,
  now = Date.now(),
): ReadonlyArray<DialogSelectOption<ArtifactSummary>> => {
  if (activeSessionID === undefined) {
    return items.map((item) => toSelectOption(item, now));
  }
  const inSession = items
    .filter((item) => item.sessionID === activeSessionID)
    .map((item) => toSelectOption(item, now, activeSessionID));
  const inProject = items
    .filter((item) => item.sessionID !== activeSessionID)
    .map((item) => toSelectOption(item, now, activeSessionID));
  return [...inSession, ...inProject];
};

export const searchArtifactOptions = (
  query: string,
  options: ReadonlyArray<DialogSelectOption<ArtifactSummary>>,
): ReadonlyArray<DialogSelectOption<ArtifactSummary>> => {
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0) return options;

  const tokens = normalized.split(/\s+/).filter(Boolean);
  return options
    .filter((option) => {
      const haystack = [
        option.title,
        option.description ?? "",
        option.footer ?? "",
        option.value.id,
        option.value.provider,
        option.value.sessionID ?? "",
        option.value.sessionTitle ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return tokens.every((token) => haystack.includes(token));
    })
    .toSorted((left, right) => {
      const leftPrefix =
        left.title.toLowerCase().startsWith(normalized) ||
        left.value.id.toLowerCase().startsWith(normalized);
      const rightPrefix =
        right.title.toLowerCase().startsWith(normalized) ||
        right.value.id.toLowerCase().startsWith(normalized);
      return Number(rightPrefix) - Number(leftPrefix);
    });
};

export const openToastOf = (
  label: string,
  outcome: OpenResult,
): { readonly message: string; readonly variant: "success" | "info" | "error" } => {
  if (outcome.status === "failed") return { message: outcome.problem, variant: "error" };
  if (outcome.via === "browse") {
    return { message: `${label} opened in Browse (tab ${outcome.tab})`, variant: "success" };
  }
  return outcome.fallbackReason !== undefined
    ? { message: `${label} opened in system browser (${outcome.fallbackReason})`, variant: "info" }
    : { message: `${label} opened in system browser`, variant: "success" };
};

export const artifactCommands = (
  onOpenModal: () => void,
  onOpenGallery: () => void,
): ReadonlyArray<KeymapCommand> => [
  {
    id: "spectre.artifacts.open",
    title: "Artifacts",
    description: "Search published artifacts and open them in Browse or the web gallery",
    group: "Spectre",
    palette: true,
    slash: { name: "artifacts", aliases: ["artifact"] },
    run: () => {
      onOpenModal();
    },
  },
  {
    id: "spectre.artifacts.gallery",
    title: "Artifact Gallery",
    description: "Open the interactive artifact gallery in Browse",
    group: "Spectre",
    palette: true,
    run: () => {
      onOpenGallery();
    },
  },
];

const reportNonOkList = (
  listed: Exclude<ArtifactListResult, { readonly status: "ok" }>,
  toast: Pick<Toast, "show">,
): void => {
  toast.show({
    title: "Artifacts",
    message:
      listed.status === "disabled"
        ? "Enable experimental.artifacts in opencode.json (or OPENCODE_FLAGS=artifacts) to view artifacts"
        : listed.message,
    variant: listed.status === "disabled" ? "warning" : "error",
  });
};

const modalActions = (input: {
  readonly clear: () => void;
  readonly onAction: (
    item: ArtifactSummary | undefined,
    kind: "standalone" | "system" | "gallery",
  ) => void;
}): ReadonlyArray<DialogSelectAction<ArtifactSummary>> => [
  {
    bind: "ctrl+d",
    title: "Standalone",
    selection: "required",
    onTrigger: (value) => {
      input.clear();
      input.onAction(value, "standalone");
    },
  },
  {
    bind: "ctrl+o",
    title: "System browser",
    selection: "required",
    onTrigger: (value) => {
      input.clear();
      input.onAction(value, "system");
    },
  },
  {
    bind: "ctrl+g",
    title: "Gallery",
    selection: "none",
    onTrigger: () => {
      input.clear();
      input.onAction(undefined, "gallery");
    },
  },
];

const targetForModalAction = (
  running: GalleryServer,
  kind: "standalone" | "system" | "gallery",
  value: ArtifactSummary | undefined,
  fallbackId: string | undefined,
): { readonly label: string; readonly url: string; readonly mode: OpenMode } => {
  if (kind === "standalone" && value !== undefined) {
    return { label: value.title, url: running.standaloneUrl(value.id), mode: "auto" };
  }
  if (kind === "system" && value !== undefined) {
    return { label: value.title, url: running.galleryUrl(value.id), mode: "system" };
  }
  return { label: "Artifact gallery", url: running.galleryUrl(fallbackId), mode: "auto" };
};

export const createArtifactsController = (input: {
  readonly store: ArtifactStore;
  readonly dialog: ArtifactDialog;
  readonly toast: Pick<Toast, "show">;
  readonly resolveContext: () => ActiveLocationContext;
  readonly opener?: BrowserOpener;
  readonly startServer?: typeof startGalleryServer;
}): ArtifactsController => {
  const opener = input.opener ?? createBrowserOpener();
  const startServer = input.startServer ?? startGalleryServer;
  let server: GalleryServer | undefined;
  let lastSelectedID: string | undefined;
  let disposed = false;

  const ensureServer = (): GalleryServer | undefined => {
    if (disposed) return undefined;
    if (server === undefined) {
      server = startServer({ store: input.store, getContext: input.resolveContext });
    }
    return server;
  };

  const launchUrl = async (label: string, url: string, mode: OpenMode = "auto"): Promise<void> => {
    const toast = openToastOf(label, await opener.open(url, mode));
    if (disposed) return;
    input.toast.show({ title: "Artifacts", message: toast.message, variant: toast.variant });
  };

  const loadReadyList = async () => {
    const active = input.resolveContext();
    const listed = await input.store.list(active.directory, active.sessionID);
    if (disposed) return undefined;
    if (listed.status !== "ok") {
      reportNonOkList(listed, input.toast);
      return undefined;
    }
    return { active, items: listed.items };
  };

  const openGallery = async (): Promise<void> => {
    const ready = await loadReadyList();
    const running = ready === undefined ? undefined : ensureServer();
    if (ready === undefined || running === undefined) return;
    const initialID =
      ready.items.find((item) => item.id === lastSelectedID)?.id ?? ready.items[0]?.id;
    await launchUrl("Artifact gallery", running.galleryUrl(initialID), "auto");
  };

  const openModal = async (): Promise<void> => {
    const ready = await loadReadyList();
    if (ready === undefined) return;
    if (ready.items.length === 0) {
      input.toast.show({
        title: "Artifacts",
        message: "No artifacts published in this project yet",
        variant: "info",
      });
      return;
    }

    const options = toDialogOptions(ready.items, ready.active.sessionID);
    let pendingAction: Promise<void> | undefined;

    const selected = await input.dialog.select({
      title: "Artifacts",
      placeholder: "Search title, art_ id, entry, or session...",
      options,
      current: options.find((option) => option.value.id === lastSelectedID)?.value,
      search: searchArtifactOptions,
      actions: modalActions({
        clear: () => input.dialog.clear(),
        onAction: (value, kind) => {
          if (value !== undefined) lastSelectedID = value.id;
          const running = ensureServer();
          if (running === undefined) return;
          const target = targetForModalAction(
            running,
            kind,
            value,
            lastSelectedID ?? ready.items[0]?.id,
          );
          pendingAction = launchUrl(target.label, target.url, target.mode);
        },
      }),
    });

    if (pendingAction !== undefined) {
      await pendingAction;
      return;
    }
    const running = selected === undefined ? undefined : ensureServer();
    if (selected === undefined || running === undefined) return;
    lastSelectedID = selected.id;
    await launchUrl(selected.title, running.galleryUrl(selected.id), "auto");
  };

  return {
    openModal,
    openGallery,
    dispose: () => {
      disposed = true;
      server?.stop();
      server = undefined;
    },
  };
};
