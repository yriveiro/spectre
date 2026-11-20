import type {
  Dialog,
  DialogPromptOptions,
  DialogSelectAction,
  DialogSelectOption,
  DialogSelectOptions,
  KeymapCommand,
  Toast,
} from "@opencode/plugin/tui/context";
import { type BrowserOpener, createBrowserOpener, type OpenMode, type OpenResult } from "./open.ts";
import {
  type ArtifactListResult,
  type ArtifactScope,
  type ArtifactStore,
  type ArtifactSummary,
  type DirectoryListingResult,
  defaultHomeDirectory,
  folderNameOf,
  type GalleryServer,
  type GalleryUrlOptions,
  type ProjectTarget,
  type ResolvedArtifactStore,
  resolveDirectoryPath,
  startGalleryServer,
  withStoreDefaults,
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
  type ArtifactScope,
  type ArtifactStore,
  type ArtifactStoreClient,
  type ArtifactSummary,
  classifyClientFailure,
  contentTypeFor,
  createRequestHandler,
  type DirectoryEntry,
  type DirectoryListingResult,
  defaultHomeDirectory,
  folderNameOf,
  formatGalleryUrl,
  type GalleryServer,
  type GalleryUrlOptions,
  type KnownProjectSeed,
  type KnownSessionSeed,
  makeClientArtifactStore,
  normalizeSubpath,
  type ProjectTarget,
  parentDirectoryOf,
  parseArtifactsRequestScope,
  type ResolvedArtifactStore,
  resolveDirectoryPath,
  startGalleryServer,
  withStoreDefaults,
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
  readonly select: <Value>(options: DialogSelectOptions<Value>) => Promise<Value | undefined>;
  readonly prompt?: (options: DialogPromptOptions) => Promise<string | undefined>;
};

export type ScopePickerChoice =
  | { readonly kind: "scope"; readonly scope: ArtifactScope }
  | { readonly kind: "browse"; readonly directory: string }
  | { readonly kind: "prompt"; readonly directory: string };

export type FilesystemChoice =
  | { readonly kind: "choose"; readonly directory: string }
  | { readonly kind: "navigate"; readonly directory: string };

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

const projectBadgeOf = (item: ArtifactSummary, showProject: boolean): string | undefined => {
  if (!showProject) return undefined;
  if (item.projectName !== undefined) return item.projectName;
  return item.projectDirectory === undefined ? undefined : folderNameOf(item.projectDirectory);
};

const toSelectOption = (
  item: ArtifactSummary,
  now: number,
  activeSessionID?: string,
  showProject = false,
): DialogSelectOption<ArtifactSummary> => {
  const isCurrentSession = activeSessionID !== undefined && item.sessionID === activeSessionID;
  const showOtherSession =
    !isCurrentSession && item.sessionTitle !== undefined && item.sessionTitle.length > 0;
  const footerParts = [
    item.provider === "local" ? undefined : item.provider,
    projectBadgeOf(item, showProject),
    isCurrentSession ? "current" : undefined,
    formatRelativeTime(item.updatedAt, now),
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
  options?: { readonly showProject?: boolean | undefined },
): ReadonlyArray<DialogSelectOption<ArtifactSummary>> => {
  const showProject = options?.showProject === true;
  if (activeSessionID === undefined) {
    return items.map((item) => toSelectOption(item, now, undefined, showProject));
  }
  const inSession = items
    .filter((item) => item.sessionID === activeSessionID)
    .map((item) => toSelectOption(item, now, activeSessionID, showProject));
  const rest = items
    .filter((item) => item.sessionID !== activeSessionID)
    .map((item) => toSelectOption(item, now, activeSessionID, showProject));
  return [...inSession, ...rest];
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
        option.value.projectName ?? "",
        option.value.projectDirectory ?? "",
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
    id: "spectre.artifacts.search",
    title: "Artifact Search",
    description:
      "Search published artifacts across projects or the filesystem and open them in Browse",
    group: "Spectre",
    palette: true,
    slash: { name: "artifact-search" },
    run: () => {
      onOpenModal();
    },
  },
  {
    id: "spectre.artifacts.gallery",
    title: "Artifact Gallery",
    description: "Open the interactive multi-project artifact gallery in Browse",
    group: "Spectre",
    palette: true,
    slash: { name: "artifact-gallery" },
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

type ModalTrigger =
  | {
      readonly type: "open";
      readonly kind: "standalone" | "system" | "gallery";
      readonly item: ArtifactSummary | undefined;
    }
  | { readonly type: "toggle-all" }
  | { readonly type: "pick-scope" };

const modalActions = (input: {
  readonly scope: ArtifactScope;
  readonly clear: () => void;
  readonly onTrigger: (trigger: ModalTrigger) => void;
}): ReadonlyArray<DialogSelectAction<ArtifactSummary>> => [
  {
    bind: "ctrl+d",
    title: "Standalone",
    selection: "required",
    onTrigger: (value) => {
      input.onTrigger({ type: "open", kind: "standalone", item: value });
      input.clear();
    },
  },
  {
    bind: "ctrl+o",
    title: "System browser",
    selection: "required",
    onTrigger: (value) => {
      input.onTrigger({ type: "open", kind: "system", item: value });
      input.clear();
    },
  },
  {
    bind: "ctrl+g",
    title: "Gallery",
    selection: "none",
    onTrigger: () => {
      input.onTrigger({ type: "open", kind: "gallery", item: undefined });
      input.clear();
    },
  },
  {
    bind: "ctrl+a",
    title: input.scope.kind === "all" ? "Current project" : "All projects",
    selection: "none",
    onTrigger: () => {
      input.onTrigger({ type: "toggle-all" });
      input.clear();
    },
  },
  {
    bind: "ctrl+f",
    title: "Switch project",
    selection: "none",
    onTrigger: () => {
      input.onTrigger({ type: "pick-scope" });
      input.clear();
    },
  },
];

const galleryOptionsForScope = (
  scope: ArtifactScope,
  resolvedDirectory: string,
): GalleryUrlOptions | undefined => {
  if (scope.kind === "all") return { scope: "all" };
  return scope.kind === "directory" ? { directory: resolvedDirectory } : undefined;
};

const targetForModalAction = (
  running: GalleryServer,
  kind: "standalone" | "system" | "gallery",
  value: ArtifactSummary | undefined,
  fallbackId: string | undefined,
  galleryOptions?: GalleryUrlOptions,
): { readonly label: string; readonly url: string; readonly mode: OpenMode } => {
  if (kind === "standalone" && value !== undefined) {
    return { label: value.title, url: running.standaloneUrl(value.id), mode: "auto" };
  }
  if (kind === "system" && value !== undefined) {
    return {
      label: value.title,
      url: running.galleryUrl(value.id, galleryOptions),
      mode: "system",
    };
  }
  return {
    label: "Artifact gallery",
    url: running.galleryUrl(fallbackId, galleryOptions),
    mode: "auto",
  };
};

const scopeForDirectory = (rawDirectory: string, activeDirectory: string): ArtifactScope => {
  const home = defaultHomeDirectory();
  const target = resolveDirectoryPath(rawDirectory, activeDirectory, home);
  const active = resolveDirectoryPath(activeDirectory, activeDirectory, home);
  return target === active ? { kind: "current" } : { kind: "directory", directory: target };
};

const isPathLikeQuery = (raw: string): boolean =>
  raw.startsWith("/") ||
  raw.startsWith("~") ||
  raw.startsWith("./") ||
  raw.startsWith("../") ||
  raw === ".." ||
  /^[A-Za-z]:[\\/]/u.test(raw);

const filterScopeOptions = (
  query: string,
  options: ReadonlyArray<DialogSelectOption<ScopePickerChoice>>,
  activeDirectory: string,
): ReadonlyArray<DialogSelectOption<ScopePickerChoice>> => {
  const trimmed = query.trim();
  if (trimmed.length === 0) return options;
  const tokens = trimmed.toLowerCase().split(/\s+/).filter(Boolean);
  const matched = options.filter((option) => {
    const hay = `${option.title} ${option.description ?? ""} ${option.footer ?? ""}`.toLowerCase();
    return tokens.every((token) => hay.includes(token));
  });
  if (!isPathLikeQuery(trimmed)) return matched;
  return [
    ...matched,
    {
      title: `Open path: ${trimmed}`,
      description: resolveDirectoryPath(trimmed, activeDirectory, defaultHomeDirectory()),
      footer: "path",
      value: { kind: "scope", scope: scopeForDirectory(trimmed, activeDirectory) },
    },
  ];
};

const buildFilesystemOptions = (
  listing: Extract<DirectoryListingResult, { readonly status: "ok" }>,
  formatPath: (path: string) => string,
): Array<DialogSelectOption<FilesystemChoice>> => {
  const options: Array<DialogSelectOption<FilesystemChoice>> = [
    {
      title: "Use this directory",
      description: formatPath(listing.directory),
      footer: "open artifacts",
      value: { kind: "choose", directory: listing.directory },
    },
  ];
  if (listing.parent !== undefined) {
    options.push({
      title: "..",
      description: formatPath(listing.parent),
      footer: "parent",
      value: { kind: "navigate", directory: listing.parent },
    });
  }
  if (listing.home !== undefined && listing.home !== listing.directory) {
    options.push({
      title: "~",
      description: formatPath(listing.home),
      footer: "home",
      value: { kind: "navigate", directory: listing.home },
    });
  }
  for (const entry of listing.entries) {
    options.push({
      title: `${entry.name}/`,
      description: formatPath(entry.directory),
      footer: "folder",
      value: { kind: "navigate", directory: entry.directory },
    });
  }
  return options;
};

type ScopeFlowContext = {
  readonly dialog: ArtifactDialog;
  readonly toast: Pick<Toast, "show">;
  readonly store: ResolvedArtifactStore;
  readonly activeDirectory: string;
  readonly formatPath: (path: string) => string;
  readonly isDisposed: () => boolean;
};

type FilesystemStepResult =
  | { readonly kind: "done"; readonly scope: ArtifactScope | undefined }
  | { readonly kind: "continue"; readonly cursor: string };

const filesystemActions = (
  flow: ScopeFlowContext,
  onDirect: (directory: string) => void,
  onPrompt: () => void,
): Array<DialogSelectAction<FilesystemChoice>> => [
  {
    bind: "ctrl+o",
    title: "Open artifacts",
    selection: "required",
    onTrigger: (choice) => {
      onDirect(choice.directory);
      flow.dialog.clear();
    },
  },
  ...(flow.dialog.prompt === undefined
    ? []
    : [
        {
          bind: "ctrl+g",
          title: "Go to path",
          selection: "none" as const,
          onTrigger: () => {
            onPrompt();
            flow.dialog.clear();
          },
        },
      ]),
];

const stepFilesystem = async (
  flow: ScopeFlowContext,
  cursor: string,
): Promise<FilesystemStepResult> => {
  const listing = await flow.store.listDirectories(cursor, flow.activeDirectory);
  if (flow.isDisposed()) return { kind: "done", scope: undefined };
  if (listing.status !== "ok") {
    flow.toast.show({ title: "Artifacts", message: listing.message, variant: "error" });
    return { kind: "done", scope: undefined };
  }

  let directDirectory: string | undefined;
  let promptRequested = false;
  const chosen = await flow.dialog.select({
    title: `Browse · ${flow.formatPath(listing.directory)}`,
    placeholder: "Filter folders (Enter opens folder, ctrl+o views its artifacts)...",
    options: buildFilesystemOptions(listing, flow.formatPath),
    actions: filesystemActions(
      flow,
      (dir) => {
        directDirectory = dir;
      },
      () => {
        promptRequested = true;
      },
    ),
  });

  if (flow.isDisposed()) return { kind: "done", scope: undefined };
  if (directDirectory !== undefined) {
    return { kind: "done", scope: scopeForDirectory(directDirectory, flow.activeDirectory) };
  }
  if (promptRequested && flow.dialog.prompt !== undefined) {
    const typed = await flow.dialog.prompt({
      title: "Jump to directory",
      placeholder: "/path/to/folder or ~/...",
      value: listing.directory,
    });
    const nextCursor =
      typed !== undefined && typed.trim().length > 0
        ? resolveDirectoryPath(typed, listing.directory, listing.home)
        : cursor;
    return { kind: "continue", cursor: nextCursor };
  }
  if (chosen === undefined) return { kind: "done", scope: undefined };
  if (chosen.kind === "choose") {
    return { kind: "done", scope: scopeForDirectory(chosen.directory, flow.activeDirectory) };
  }
  return { kind: "continue", cursor: chosen.directory };
};

const browseFilesystem = async (
  flow: ScopeFlowContext,
  startDirectory: string,
): Promise<ArtifactScope | undefined> => {
  for (let cursor = startDirectory; !flow.isDisposed(); ) {
    const outcome = await stepFilesystem(flow, cursor);
    if (outcome.kind === "done") return outcome.scope;
    cursor = outcome.cursor;
  }
  return undefined;
};

const projectFooterLabel = (
  proj: ProjectTarget,
  currentScope: ArtifactScope,
  selectedDir: string | undefined,
  activeDirectory: string,
): string | undefined => {
  const home = defaultHomeDirectory();
  const isSelected =
    (currentScope.kind === "current" && proj.isCurrent) ||
    (selectedDir !== undefined &&
      resolveDirectoryPath(proj.directory, activeDirectory, home) === selectedDir);
  const roleLabel =
    proj.kind === "worktree" ? "worktree" : proj.kind === "custom" ? "custom" : undefined;
  const parts = [
    roleLabel,
    proj.isCurrent ? "current" : undefined,
    isSelected && !proj.isCurrent ? "selected" : undefined,
  ].filter((part): part is string => part !== undefined);
  return parts.length > 0 ? parts.join(" · ") : undefined;
};

const buildScopePickerOptions = (input: {
  readonly projects: ReadonlyArray<ProjectTarget>;
  readonly currentScope: ArtifactScope;
  readonly currentDirectory: string;
  readonly activeDirectory: string;
  readonly hasPrompt: boolean;
  readonly formatPath: (path: string) => string;
}): Array<DialogSelectOption<ScopePickerChoice>> => {
  const home = defaultHomeDirectory();
  const selectedDir =
    input.currentScope.kind === "directory"
      ? resolveDirectoryPath(input.currentScope.directory, input.activeDirectory, home)
      : undefined;

  const options: Array<DialogSelectOption<ScopePickerChoice>> = [
    {
      title: "All projects",
      description: "Show published canvases across every project",
      footer: input.currentScope.kind === "all" ? "selected" : "all",
      value: { kind: "scope", scope: { kind: "all" } },
    },
    {
      title: "Browse filesystem…",
      description: input.formatPath(input.currentDirectory),
      footer: "folders",
      value: { kind: "browse", directory: input.currentDirectory },
    },
  ];
  if (input.hasPrompt) {
    options.push({
      title: "Enter path…",
      description: "Type or paste any directory path on disk",
      footer: "path",
      value: { kind: "prompt", directory: input.currentDirectory },
    });
  }
  for (const proj of input.projects) {
    options.push({
      title: proj.name,
      description: input.formatPath(proj.directory),
      footer: projectFooterLabel(proj, input.currentScope, selectedDir, input.activeDirectory),
      value: {
        kind: "scope",
        scope: proj.isCurrent
          ? { kind: "current" }
          : { kind: "directory", directory: proj.directory },
      },
    });
  }
  return options;
};

const resolvePickedChoice = async (
  flow: ScopeFlowContext,
  picked: ScopePickerChoice,
): Promise<ArtifactScope | undefined> => {
  if (picked.kind === "scope") return picked.scope;
  if (picked.kind === "browse") return browseFilesystem(flow, picked.directory);
  if (flow.dialog.prompt === undefined) return undefined;
  const typed = await flow.dialog.prompt({
    title: "Open directory",
    placeholder: "/path/to/project or ~/...",
    value: picked.directory,
  });
  return typed !== undefined && typed.trim().length > 0
    ? scopeForDirectory(typed, flow.activeDirectory)
    : undefined;
};

const pickArtifactScope = async (
  flow: ScopeFlowContext,
  currentScope: ArtifactScope,
  currentDirectory: string,
): Promise<ArtifactScope | undefined> => {
  while (!flow.isDisposed()) {
    const projects = await flow.store.listProjects(flow.activeDirectory);
    if (flow.isDisposed()) return undefined;

    const options = buildScopePickerOptions({
      projects,
      currentScope,
      currentDirectory,
      activeDirectory: flow.activeDirectory,
      hasPrompt: flow.dialog.prompt !== undefined,
      formatPath: flow.formatPath,
    });
    const picked = await flow.dialog.select({
      title: "Select project or directory",
      placeholder: "Search projects, worktrees, or type /path...",
      options,
      search: (query, opts) => filterScopeOptions(query, opts, flow.activeDirectory),
    });

    if (flow.isDisposed() || picked === undefined) return undefined;
    const resolved = await resolvePickedChoice(flow, picked);
    if (resolved !== undefined) return resolved;
  }
  return undefined;
};

type LoadedScopeList = {
  readonly active: ActiveLocationContext;
  readonly directory: string;
  readonly projectName: string;
  readonly effectiveSessionID: string | undefined;
  readonly items: ReadonlyArray<ArtifactSummary>;
};

const loadScopeArtifacts = async (
  store: ResolvedArtifactStore,
  active: ActiveLocationContext,
  scope: ArtifactScope,
  toast: Pick<Toast, "show">,
  isDisposed: () => boolean,
): Promise<LoadedScopeList | undefined> => {
  const home = defaultHomeDirectory();
  if (scope.kind === "all") {
    const listed = await store.listAll(active.directory, active.sessionID);
    if (isDisposed()) return undefined;
    if (listed.status !== "ok") {
      reportNonOkList(listed, toast);
      return undefined;
    }
    return {
      active,
      directory: active.directory,
      projectName: "All projects",
      effectiveSessionID: active.sessionID,
      items: listed.items,
    };
  }

  const targetDir =
    scope.kind === "directory"
      ? resolveDirectoryPath(scope.directory, active.directory, home)
      : active.directory;
  const isCurrent =
    resolveDirectoryPath(targetDir, active.directory, home) ===
    resolveDirectoryPath(active.directory, active.directory, home);
  const effectiveSessionID = isCurrent ? active.sessionID : undefined;
  const listed = await store.list(targetDir, effectiveSessionID);
  if (isDisposed()) return undefined;
  if (listed.status !== "ok") {
    reportNonOkList(listed, toast);
    return undefined;
  }
  return {
    active,
    directory: targetDir,
    projectName: listed.projectName ?? listed.items[0]?.projectName ?? folderNameOf(targetDir),
    effectiveSessionID,
    items: listed.items,
  };
};

const modalPlaceholderFor = (scope: ArtifactScope, hasItems: boolean): string => {
  if (hasItems) {
    return scope.kind === "all"
      ? "Search title, art_ id, project, entry, or session..."
      : "Search title, art_ id, entry, or session...";
  }
  return scope.kind === "all"
    ? "No artifacts published across any project yet"
    : "No artifacts in this project — ctrl+a all projects · ctrl+f switch project/path";
};

type ControllerRuntime = {
  readonly store: ResolvedArtifactStore;
  readonly dialog: ArtifactDialog;
  readonly toast: Pick<Toast, "show">;
  readonly resolveContext: () => ActiveLocationContext;
  readonly formatPath: (path: string) => string;
  readonly ensureServer: () => GalleryServer | undefined;
  readonly launchUrl: (label: string, url: string, mode?: OpenMode) => Promise<void>;
  readonly isDisposed: () => boolean;
  readonly getLastSelectedID: () => string | undefined;
  readonly setLastSelectedID: (id: string) => void;
};

type ModalIterationOutcome =
  | { readonly kind: "done" }
  | { readonly kind: "continue"; readonly scope: ArtifactScope };

const openFromTrigger = async (
  runtime: ControllerRuntime,
  ready: LoadedScopeList,
  scope: ArtifactScope,
  trigger: Extract<ModalTrigger, { readonly type: "open" }>,
): Promise<void> => {
  if (trigger.item !== undefined) runtime.setLastSelectedID(trigger.item.id);
  const running = runtime.ensureServer();
  if (running === undefined) return;
  const target = targetForModalAction(
    running,
    trigger.kind,
    trigger.item,
    runtime.getLastSelectedID() ?? ready.items[0]?.id,
    galleryOptionsForScope(scope, ready.directory),
  );
  await runtime.launchUrl(target.label, target.url, target.mode);
};

const dispatchModalOutcome = async (
  runtime: ControllerRuntime,
  ready: LoadedScopeList,
  scope: ArtifactScope,
  trigger: ModalTrigger | undefined,
  selected: ArtifactSummary | undefined,
): Promise<ModalIterationOutcome> => {
  if (trigger?.type === "toggle-all") {
    return {
      kind: "continue",
      scope: scope.kind === "all" ? { kind: "current" } : { kind: "all" },
    };
  }
  if (trigger?.type === "pick-scope") {
    const next = await pickArtifactScope(
      { ...runtime, activeDirectory: ready.active.directory },
      scope,
      ready.directory,
    );
    return { kind: "continue", scope: next ?? scope };
  }
  if (trigger?.type === "open") {
    await openFromTrigger(runtime, ready, scope, trigger);
    return { kind: "done" };
  }

  const running = selected === undefined ? undefined : runtime.ensureServer();
  if (selected !== undefined && running !== undefined) {
    runtime.setLastSelectedID(selected.id);
    const galleryOpts = galleryOptionsForScope(scope, ready.directory);
    await runtime.launchUrl(selected.title, running.galleryUrl(selected.id, galleryOpts), "auto");
  }
  return { kind: "done" };
};

const runModalIteration = async (
  runtime: ControllerRuntime,
  scope: ArtifactScope,
): Promise<ModalIterationOutcome> => {
  const active = runtime.resolveContext();
  const ready = await loadScopeArtifacts(
    runtime.store,
    active,
    scope,
    runtime.toast,
    runtime.isDisposed,
  );
  if (ready === undefined) {
    if (scope.kind === "current" || runtime.isDisposed()) return { kind: "done" };
    const recovered = await pickArtifactScope(
      { ...runtime, activeDirectory: active.directory },
      scope,
      active.directory,
    );
    return recovered === undefined ? { kind: "done" } : { kind: "continue", scope: recovered };
  }

  const options = toDialogOptions(ready.items, ready.effectiveSessionID, Date.now(), {
    showProject: scope.kind === "all",
  });
  const lastID = runtime.getLastSelectedID();
  let trigger: ModalTrigger | undefined;
  const selected = await runtime.dialog.select({
    title: scope.kind === "all" ? "Artifacts · All projects" : `Artifacts · ${ready.projectName}`,
    placeholder: modalPlaceholderFor(scope, options.length > 0),
    options,
    current: options.find((option) => option.value.id === lastID)?.value,
    search: searchArtifactOptions,
    actions: modalActions({
      scope,
      clear: () => runtime.dialog.clear(),
      onTrigger: (next) => {
        trigger = next;
      },
    }),
  });

  if (runtime.isDisposed()) return { kind: "done" };
  return dispatchModalOutcome(runtime, ready, scope, trigger, selected);
};

const runModalLoop = async (runtime: ControllerRuntime): Promise<void> => {
  let scope: ArtifactScope = { kind: "current" };
  while (!runtime.isDisposed()) {
    const step = await runModalIteration(runtime, scope);
    if (step.kind === "done") return;
    scope = step.scope;
  }
};

export const createArtifactsController = (input: {
  readonly store: ArtifactStore;
  readonly dialog: ArtifactDialog;
  readonly toast: Pick<Toast, "show">;
  readonly resolveContext: () => ActiveLocationContext;
  readonly formatPath?: ((path: string) => string) | undefined;
  readonly opener?: BrowserOpener;
  readonly startServer?: typeof startGalleryServer;
}): ArtifactsController => {
  const store = withStoreDefaults(input.store);
  const formatPath = input.formatPath ?? ((value: string) => value);
  const opener = input.opener ?? createBrowserOpener();
  const startServer = input.startServer ?? startGalleryServer;
  let server: GalleryServer | undefined;
  let lastSelectedID: string | undefined;
  let disposed = false;

  const ensureServer = (): GalleryServer | undefined => {
    if (disposed) return undefined;
    if (server === undefined) {
      server = startServer({ store, getContext: input.resolveContext });
    }
    return server;
  };

  const launchUrl = async (label: string, url: string, mode: OpenMode = "auto"): Promise<void> => {
    const toast = openToastOf(label, await opener.open(url, mode));
    if (!disposed) {
      input.toast.show({ title: "Artifacts", message: toast.message, variant: toast.variant });
    }
  };

  const runtime: ControllerRuntime = {
    store,
    dialog: input.dialog,
    toast: input.toast,
    resolveContext: input.resolveContext,
    formatPath,
    ensureServer,
    launchUrl,
    isDisposed: () => disposed,
    getLastSelectedID: () => lastSelectedID,
    setLastSelectedID: (id) => {
      lastSelectedID = id;
    },
  };

  const openGallery = async (): Promise<void> => {
    const ready = await loadScopeArtifacts(
      store,
      input.resolveContext(),
      { kind: "current" },
      input.toast,
      () => disposed,
    );
    const running = ready === undefined ? undefined : ensureServer();
    if (ready === undefined || running === undefined) return;
    const initialID =
      ready.items.find((item) => item.id === lastSelectedID)?.id ?? ready.items[0]?.id;
    await launchUrl("Artifact gallery", running.galleryUrl(initialID), "auto");
  };

  const openModal = (): Promise<void> => runModalLoop(runtime);

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
