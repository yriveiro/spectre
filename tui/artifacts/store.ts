import { basename, dirname, resolve } from "node:path";
import type { ArtifactInfo, OpenCodeClient, Project } from "@opencode/client";

export type ArtifactScope =
  | { readonly kind: "current" }
  | { readonly kind: "all" }
  | { readonly kind: "directory"; readonly directory: string };

export type ArtifactSummary = {
  readonly id: string;
  readonly title: string;
  readonly entry: string;
  readonly provider: string;
  readonly sessionID: string | undefined;
  readonly sessionTitle: string | undefined;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly projectDirectory?: string | undefined;
  readonly projectName?: string | undefined;
};

export type ArtifactListResult =
  | {
      readonly status: "ok";
      readonly directory: string;
      readonly sessionID: string | undefined;
      readonly items: ReadonlyArray<ArtifactSummary>;
      readonly scope?: "current" | "all" | "directory" | undefined;
      readonly activeDirectory?: string | undefined;
      readonly projectName?: string | undefined;
    }
  | {
      readonly status: "disabled";
      readonly directory: string;
      readonly message: string;
    }
  | {
      readonly status: "error";
      readonly directory: string;
      readonly message: string;
    };

export type ArtifactReadResult =
  | {
      readonly status: "ok";
      readonly id: string;
      readonly title: string;
      readonly entry: string;
      readonly files: Readonly<Record<string, string>>;
    }
  | { readonly status: "not-found"; readonly message: string }
  | { readonly status: "disabled"; readonly message: string }
  | { readonly status: "error"; readonly message: string };

export type ProjectTarget = {
  readonly id?: string | undefined;
  readonly name: string;
  readonly directory: string;
  readonly kind: "project" | "worktree" | "session" | "custom";
  readonly isCurrent: boolean;
};

export type DirectoryEntry = {
  readonly name: string;
  readonly directory: string;
};

export type DirectoryListingResult =
  | {
      readonly status: "ok";
      readonly directory: string;
      readonly parent: string | undefined;
      readonly home: string | undefined;
      readonly entries: ReadonlyArray<DirectoryEntry>;
    }
  | {
      readonly status: "error";
      readonly directory: string;
      readonly message: string;
    };

export type ArtifactStore = {
  readonly list: (directory: string, sessionID?: string) => Promise<ArtifactListResult>;
  readonly get: (artifactID: string, directory?: string) => Promise<ArtifactReadResult>;
  readonly listAll?: (
    activeDirectory: string,
    activeSessionID?: string,
  ) => Promise<ArtifactListResult>;
  readonly listProjects?: (activeDirectory: string) => Promise<ReadonlyArray<ProjectTarget>>;
  readonly listDirectories?: (
    targetPath: string,
    anchorDirectory: string,
  ) => Promise<DirectoryListingResult>;
};

export type ResolvedArtifactStore = Required<ArtifactStore>;

export type ArtifactStoreClient = Pick<OpenCodeClient, "experimental"> &
  Partial<Pick<OpenCodeClient, "project" | "worktree" | "file">>;

export type KnownProjectSeed = {
  readonly id?: string | undefined;
  readonly canonical: string;
  readonly name?: string | undefined;
  readonly vcs?: string | undefined;
  readonly activeAt?: number | undefined;
};

export type KnownSessionSeed = {
  readonly id: string;
  readonly directory: string;
  readonly projectID?: string | undefined;
  readonly title?: string | undefined;
};

const SCAN_CONCURRENCY = 6;

export const folderNameOf = (directory: string): string => {
  const leaf = basename(resolve(directory));
  return leaf.length > 0 ? leaf : resolve(directory);
};

export const parentDirectoryOf = (directory: string): string | undefined => {
  const full = resolve(directory);
  const up = dirname(full);
  return up === full ? undefined : up;
};

export const resolveDirectoryPath = (
  rawPath: string,
  baseDirectory: string,
  homeDirectory?: string,
): string => {
  const trimmed = rawPath.trim();
  if (trimmed.length === 0) return resolve(baseDirectory);
  if (homeDirectory !== undefined && homeDirectory.length > 0) {
    if (trimmed === "~") return resolve(homeDirectory);
    if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
      return resolve(homeDirectory, trimmed.slice(2));
    }
  }
  return resolve(baseDirectory, trimmed);
};

export const defaultHomeDirectory = (): string | undefined => {
  const raw = Bun.env.HOME ?? Bun.env.USERPROFILE;
  return raw !== undefined && raw.trim().length > 0 ? resolve(raw) : undefined;
};

export const withStoreDefaults = (store: ArtifactStore): ResolvedArtifactStore => ({
  list: store.list,
  get: store.get,
  listAll:
    store.listAll ??
    (async (activeDirectory, activeSessionID) => {
      const listed = await store.list(activeDirectory, activeSessionID);
      if (listed.status !== "ok") return listed;
      return { ...listed, scope: "all", activeDirectory, projectName: "All projects" };
    }),
  listProjects:
    store.listProjects ??
    (async (activeDirectory) => [
      {
        name: folderNameOf(activeDirectory),
        directory: resolve(activeDirectory),
        kind: "project",
        isCurrent: true,
      },
    ]),
  listDirectories:
    store.listDirectories ??
    (async (targetPath, anchorDirectory) => {
      const home = defaultHomeDirectory();
      const directory = resolveDirectoryPath(targetPath, anchorDirectory, home);
      return {
        status: "ok",
        directory,
        parent: parentDirectoryOf(directory),
        home,
        entries: [],
      };
    }),
});

export const classifyClientFailure = (
  cause: unknown,
): {
  readonly kind: "disabled" | "not-found" | "location-missing" | "error";
  readonly message: string;
} => {
  const record =
    typeof cause === "object" && cause !== null ? (cause as Record<string, unknown>) : undefined;
  const tag = typeof record?._tag === "string" ? record._tag : undefined;
  const status = typeof record?.status === "number" ? record.status : undefined;
  const message =
    cause instanceof Error && cause.message.length > 0
      ? cause.message
      : typeof record?.message === "string"
        ? record.message
        : String(cause);

  if (tag === "ForbiddenError" || status === 403) return { kind: "disabled", message };
  if (tag === "ArtifactNotFoundError" || tag === "FileNotFoundError" || status === 404) {
    return { kind: "not-found", message };
  }
  if (tag === "LocationNotFoundError") return { kind: "location-missing", message };
  return { kind: "error", message };
};

const mapConcurrent = async <Item, Result>(
  items: ReadonlyArray<Item>,
  limit: number,
  worker: (item: Item) => Promise<Result>,
): Promise<Array<Result>> => {
  const results = new Array<Result>(items.length);
  let cursor = 0;
  const runNext = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item !== undefined) results[index] = await worker(item);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, limit), items.length) }, () => runNext()),
  );
  return results;
};

const sortSummaries = (items: ReadonlyArray<ArtifactSummary>): Array<ArtifactSummary> =>
  items.toSorted(
    (left, right) => right.updatedAt - left.updatedAt || right.id.localeCompare(left.id),
  );

const sortDirectoryEntries = (entries: ReadonlyArray<DirectoryEntry>): Array<DirectoryEntry> =>
  entries.toSorted((left, right) => {
    const leftHidden = left.name.startsWith(".");
    const rightHidden = right.name.startsWith(".");
    if (leftHidden !== rightHidden) return leftHidden ? 1 : -1;
    return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  });

const projectLabelOf = (project: {
  readonly canonical: string;
  readonly name?: string | undefined;
}): string => {
  const trimmed = project.name?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : folderNameOf(project.canonical);
};

const uniqueCandidates = (
  preferred: string | undefined,
  fallback: string | undefined,
): ReadonlyArray<string | undefined> => {
  const out: Array<string | undefined> = [];
  if (preferred !== undefined) out.push(preferred);
  if (fallback !== undefined && fallback !== preferred) out.push(fallback);
  out.push(undefined);
  return out;
};

const fetchArtifactChain = async (
  api: NonNullable<OpenCodeClient["experimental"]["artifacts"]>,
  artifactID: string,
  candidates: ReadonlyArray<string | undefined>,
): Promise<ArtifactReadResult> => {
  let lastFailure: ReturnType<typeof classifyClientFailure> | undefined;
  for (let index = 0; index < candidates.length; index += 1) {
    const directory = candidates[index];
    try {
      const response = await api.get(
        directory === undefined ? { artifactID } : { artifactID, location: { directory } },
      );
      const { info, files } = response.data;
      return { status: "ok", id: info.id, title: info.title, entry: info.entry, files };
    } catch (cause) {
      lastFailure = classifyClientFailure(cause);
      const canRetry =
        index < candidates.length - 1 &&
        directory !== undefined &&
        (lastFailure.kind === "not-found" || lastFailure.kind === "location-missing");
      if (!canRetry) break;
    }
  }
  if (lastFailure?.kind === "disabled") return { status: "disabled", message: lastFailure.message };
  if (lastFailure?.kind === "not-found")
    return { status: "not-found", message: lastFailure.message };
  return { status: "error", message: lastFailure?.message ?? "Artifact read failed" };
};

type StoreState = {
  readonly client: ArtifactStoreClient;
  readonly sessionTitleOf: (sessionID: string) => string | undefined;
  readonly readProjects: () => ReadonlyArray<KnownProjectSeed>;
  readonly readSessions: () => ReadonlyArray<KnownSessionSeed>;
  readonly home: string | undefined;
  readonly knownArtifactDirectories: Map<string, string>;
  readonly visitedDirectories: Set<string>;
  readonly projectLabels: Map<string, string>;
  readonly directoryProjectIds: Map<string, string>;
};

type ProjectCandidate = {
  readonly id?: string | undefined;
  readonly name: string;
  readonly primaryDirectory: string;
  readonly fallbackDirectories: ReadonlyArray<string>;
};

type CandidateScanOutcome =
  | { readonly kind: "ok"; readonly items: ReadonlyArray<ArtifactSummary> }
  | { readonly kind: "disabled" | "missing" | "error"; readonly message: string };

const toSummary = (
  state: StoreState,
  info: ArtifactInfo,
  projectDirectory: string,
  projectName: string,
): ArtifactSummary => {
  state.knownArtifactDirectories.set(info.id, projectDirectory);
  return {
    id: info.id,
    title: info.title,
    entry: info.entry,
    provider: info.provider,
    sessionID: info.sessionID,
    sessionTitle: info.sessionID === undefined ? undefined : state.sessionTitleOf(info.sessionID),
    createdAt: info.time.created,
    updatedAt: info.time.updated,
    projectDirectory,
    projectName,
  };
};

const mergeProjectSeeds = (
  remote: ReadonlyArray<Project>,
  local: ReadonlyArray<KnownProjectSeed>,
  activeDirectory: string,
): Array<KnownProjectSeed> => {
  const byCanonical = new Map<string, KnownProjectSeed>();
  const register = (seed: KnownProjectSeed): void => {
    const canonical = resolve(seed.canonical);
    if (canonical === "/" && activeDirectory !== "/") return;
    const prev = byCanonical.get(canonical);
    if (prev === undefined || (seed.activeAt ?? 0) > (prev.activeAt ?? 0)) {
      byCanonical.set(canonical, { ...seed, canonical });
    }
  };
  for (const proj of remote) {
    register({
      id: proj.id,
      canonical: proj.canonical,
      name: proj.name,
      vcs: proj.vcs,
      activeAt: proj.time.active,
    });
  }
  for (const seed of local) register(seed);
  return [...byCanonical.values()].toSorted(
    (left, right) => (right.activeAt ?? 0) - (left.activeAt ?? 0),
  );
};

const fetchSeeds = async (
  state: StoreState,
  activeDirectory: string,
): Promise<Array<KnownProjectSeed>> => {
  const remote =
    (await state.client.project?.list({ archived: true }).catch(() => undefined)) ?? [];
  return mergeProjectSeeds(remote, state.readProjects(), activeDirectory);
};

const fetchWorktrees = async (
  state: StoreState,
  projectID: string,
): Promise<ReadonlyArray<string>> => {
  const worktrees = await state.client.worktree
    ?.list({ projectID: projectID as never })
    .catch(() => undefined);
  return worktrees === undefined ? [] : worktrees.map((entry) => resolve(entry.directory));
};

const queryDirectoryOnce = async (
  state: StoreState,
  api: NonNullable<OpenCodeClient["experimental"]["artifacts"]>,
  directory: string,
  projectName: string,
): Promise<CandidateScanOutcome> => {
  try {
    const response = await api.list({ location: { directory } });
    const resolvedDir =
      response.location?.directory !== undefined
        ? resolve(response.location.directory)
        : resolve(directory);
    state.projectLabels.set(resolvedDir, projectName);
    return {
      kind: "ok",
      items: response.data.map((info) => toSummary(state, info, resolvedDir, projectName)),
    };
  } catch (cause) {
    const failure = classifyClientFailure(cause);
    if (failure.kind === "location-missing") return { kind: "missing", message: failure.message };
    if (failure.kind === "disabled") return { kind: "disabled", message: failure.message };
    return { kind: "error", message: failure.message };
  }
};

const scanCandidate = async (
  state: StoreState,
  api: NonNullable<OpenCodeClient["experimental"]["artifacts"]>,
  candidate: ProjectCandidate,
): Promise<CandidateScanOutcome> => {
  const initialDirs = [candidate.primaryDirectory, ...candidate.fallbackDirectories];
  let lastMissing = "Location missing";

  for (const dir of initialDirs) {
    const outcome = await queryDirectoryOnce(state, api, dir, candidate.name);
    if (outcome.kind !== "missing") return outcome;
    lastMissing = outcome.message;
  }

  if (candidate.id === undefined || candidate.fallbackDirectories.length > 0) {
    return { kind: "missing", message: lastMissing };
  }

  for (const wtDir of await fetchWorktrees(state, candidate.id)) {
    if (initialDirs.includes(wtDir)) continue;
    const outcome = await queryDirectoryOnce(state, api, wtDir, candidate.name);
    if (outcome.kind !== "missing") return outcome;
    lastMissing = outcome.message;
  }
  return { kind: "missing", message: lastMissing };
};

const relatedDirectoriesForSeed = (
  state: StoreState,
  seed: KnownProjectSeed,
  sessions: ReadonlyArray<KnownSessionSeed>,
): Array<string> => {
  if (seed.id === undefined) return [];
  const combined = [
    ...sessions.filter((s) => s.projectID === seed.id).map((s) => resolve(s.directory)),
    ...[...state.directoryProjectIds.entries()]
      .filter(([, projId]) => projId === seed.id)
      .map(([dir]) => dir),
  ];
  return combined.filter((dir, idx) => dir !== seed.canonical && combined.indexOf(dir) === idx);
};

const buildScanCandidates = async (
  state: StoreState,
  normalizedActive: string,
): Promise<Array<ProjectCandidate>> => {
  const seeds = await fetchSeeds(state, normalizedActive);
  const sessions = state.readSessions();
  const seen = new Set<string>();
  const candidates: Array<ProjectCandidate> = [];

  for (const seed of seeds) {
    const label = projectLabelOf(seed);
    state.projectLabels.set(seed.canonical, label);
    if (seed.id !== undefined) state.directoryProjectIds.set(seed.canonical, seed.id);
    const related = relatedDirectoriesForSeed(state, seed, sessions);
    const useActive = seed.canonical === normalizedActive || related.includes(normalizedActive);
    const primary = useActive ? normalizedActive : seed.canonical;
    const fallbacks = [
      ...(primary === seed.canonical ? [] : [seed.canonical]),
      ...related.filter((dir) => dir !== primary),
    ];
    seen.add(seed.canonical);
    for (const dir of related) seen.add(dir);
    candidates.push({
      id: seed.id,
      name: label,
      primaryDirectory: primary,
      fallbackDirectories: fallbacks,
    });
  }

  const extras = [
    normalizedActive,
    ...state.visitedDirectories,
    ...sessions.map((s) => resolve(s.directory)),
  ];
  for (const dir of extras) {
    if (seen.has(dir)) continue;
    seen.add(dir);
    candidates.push({
      name: state.projectLabels.get(dir) ?? folderNameOf(dir),
      primaryDirectory: dir,
      fallbackDirectories: [],
    });
  }
  return candidates;
};

const upsertSummary = (
  merged: Map<string, ArtifactSummary>,
  item: ArtifactSummary,
  normalizedActive: string,
): void => {
  const prev = merged.get(item.id);
  const preferNew =
    prev === undefined ||
    item.updatedAt > prev.updatedAt ||
    (item.updatedAt === prev.updatedAt && item.projectDirectory === normalizedActive);
  if (preferNew) merged.set(item.id, item);
};

const mergeScanOutcomes = (
  outcomes: ReadonlyArray<CandidateScanOutcome>,
  activeDirectory: string,
  normalizedActive: string,
  activeSessionID?: string,
): ArtifactListResult => {
  const merged = new Map<string, ArtifactSummary>();
  let okCount = 0;
  let disabledMessage: string | undefined;
  let errorMessage: string | undefined;

  for (const outcome of outcomes) {
    if (outcome.kind === "ok") {
      okCount += 1;
      for (const item of outcome.items) upsertSummary(merged, item, normalizedActive);
    } else if (outcome.kind === "disabled") {
      disabledMessage ??= outcome.message;
    } else if (outcome.kind === "error") {
      errorMessage ??= outcome.message;
    }
  }

  if (okCount > 0) {
    return {
      status: "ok",
      scope: "all",
      directory: activeDirectory,
      activeDirectory,
      projectName: "All projects",
      sessionID: activeSessionID,
      items: sortSummaries([...merged.values()]),
    };
  }
  if (disabledMessage !== undefined && errorMessage === undefined) {
    return { status: "disabled", directory: activeDirectory, message: disabledMessage };
  }
  return {
    status: "error",
    directory: activeDirectory,
    message: errorMessage ?? disabledMessage ?? "Could not list artifacts across projects",
  };
};

const listStoreSingle = async (
  state: StoreState,
  directory: string,
  sessionID?: string,
): Promise<ArtifactListResult> => {
  const api = state.client.experimental?.artifacts;
  if (api === undefined) {
    return { status: "disabled", directory, message: "Artifacts API is unavailable" };
  }
  try {
    const response = await api.list({ location: { directory } });
    const resolvedDir =
      response.location?.directory !== undefined
        ? resolve(response.location.directory)
        : resolve(directory);
    state.visitedDirectories.add(resolvedDir);
    const label = state.projectLabels.get(resolvedDir) ?? folderNameOf(resolvedDir);
    const items = sortSummaries(
      response.data.map((info: ArtifactInfo) => toSummary(state, info, resolvedDir, label)),
    );
    return { status: "ok", directory, sessionID, items };
  } catch (cause) {
    const failure = classifyClientFailure(cause);
    return failure.kind === "disabled"
      ? { status: "disabled", directory, message: failure.message }
      : { status: "error", directory, message: failure.message };
  }
};

const registerSeedTargets = (
  state: StoreState,
  seeds: ReadonlyArray<KnownProjectSeed>,
  worktreeGroups: ReadonlyArray<ReadonlyArray<string>>,
  push: (target: ProjectTarget) => void,
): void => {
  seeds.forEach((seed, index) => {
    const label = projectLabelOf(seed);
    state.projectLabels.set(seed.canonical, label);
    if (seed.id !== undefined) state.directoryProjectIds.set(seed.canonical, seed.id);
    push({
      id: seed.id,
      name: label,
      directory: seed.canonical,
      kind: "project",
      isCurrent: false,
    });
    for (const wtDir of worktreeGroups[index] ?? []) {
      if (wtDir === seed.canonical) continue;
      const wtName = `${label} · ${folderNameOf(wtDir)}`;
      state.projectLabels.set(wtDir, wtName);
      if (seed.id !== undefined) state.directoryProjectIds.set(wtDir, seed.id);
      push({ id: seed.id, name: wtName, directory: wtDir, kind: "worktree", isCurrent: false });
    }
  });
};

const listStoreProjects = async (
  state: StoreState,
  activeDirectory: string,
): Promise<ReadonlyArray<ProjectTarget>> => {
  const normalizedActive = resolve(activeDirectory);
  const seeds = await fetchSeeds(state, normalizedActive);
  const worktreeGroups = await mapConcurrent(seeds, SCAN_CONCURRENCY, async (seed) =>
    seed.vcs === "git" && seed.id !== undefined ? fetchWorktrees(state, seed.id) : [],
  );

  const seen = new Map<string, ProjectTarget>();
  const push = (target: ProjectTarget): void => {
    const key = resolve(target.directory);
    if (!seen.has(key)) {
      seen.set(key, { ...target, directory: key, isCurrent: key === normalizedActive });
    }
  };

  registerSeedTargets(state, seeds, worktreeGroups, push);
  for (const session of state.readSessions()) {
    const dir = resolve(session.directory);
    push({
      id: session.projectID,
      name: state.projectLabels.get(dir) ?? folderNameOf(dir),
      directory: dir,
      kind: "session",
      isCurrent: false,
    });
  }
  for (const dir of state.visitedDirectories) {
    push({
      name: state.projectLabels.get(dir) ?? folderNameOf(dir),
      directory: dir,
      kind: "custom",
      isCurrent: false,
    });
  }
  push({
    name: state.projectLabels.get(normalizedActive) ?? folderNameOf(normalizedActive),
    directory: normalizedActive,
    kind: "project",
    isCurrent: true,
  });

  return [...seen.values()].toSorted(
    (left, right) => Number(right.isCurrent) - Number(left.isCurrent),
  );
};

const listStoreDirectories = async (
  state: StoreState,
  targetPath: string,
  anchorDirectory: string,
): Promise<DirectoryListingResult> => {
  const directory = resolveDirectoryPath(targetPath, anchorDirectory, state.home);
  const fileApi = state.client.file;
  if (fileApi === undefined) {
    return { status: "error", directory, message: "Filesystem API is unavailable" };
  }

  try {
    const response = await fileApi
      .list({ location: { directory: anchorDirectory }, path: directory })
      .catch(async (cause: unknown) => {
        if (classifyClientFailure(cause).kind === "location-missing") {
          return fileApi.list({ path: directory });
        }
        throw cause;
      });

    const base = resolve(response.location.directory);
    const byPath = new Map<string, DirectoryEntry>();
    for (const item of response.data) {
      if (item.type !== "directory") continue;
      const childDir = resolve(base, item.path);
      if (childDir !== directory) {
        byPath.set(childDir, { name: folderNameOf(childDir), directory: childDir });
      }
    }
    return {
      status: "ok",
      directory,
      parent: parentDirectoryOf(directory),
      home: state.home,
      entries: sortDirectoryEntries([...byPath.values()]),
    };
  } catch (cause) {
    return { status: "error", directory, message: classifyClientFailure(cause).message };
  }
};

export const makeClientArtifactStore = (input: {
  readonly client: ArtifactStoreClient;
  readonly sessionTitle?: (sessionID: string) => string | undefined;
  readonly projects?: () => ReadonlyArray<KnownProjectSeed>;
  readonly sessions?: () => ReadonlyArray<KnownSessionSeed>;
  readonly homeDirectory?: string | undefined;
}): ArtifactStore => {
  const state: StoreState = {
    client: input.client,
    sessionTitleOf: input.sessionTitle ?? (() => undefined),
    readProjects: input.projects ?? (() => []),
    readSessions: input.sessions ?? (() => []),
    home: input.homeDirectory !== undefined ? resolve(input.homeDirectory) : defaultHomeDirectory(),
    knownArtifactDirectories: new Map(),
    visitedDirectories: new Set(),
    projectLabels: new Map(),
    directoryProjectIds: new Map(),
  };

  return {
    list: (directory, sessionID) => listStoreSingle(state, directory, sessionID),
    get: async (artifactID, directory) => {
      const api = state.client.experimental?.artifacts;
      if (api === undefined) {
        return { status: "disabled", message: "Artifacts API is unavailable" };
      }
      const ownedBy = state.knownArtifactDirectories.get(artifactID);
      return fetchArtifactChain(api, artifactID, uniqueCandidates(ownedBy, directory));
    },
    listAll: async (activeDirectory, activeSessionID) => {
      const api = state.client.experimental?.artifacts;
      if (api === undefined) {
        return {
          status: "disabled",
          directory: activeDirectory,
          message: "Artifacts API is unavailable",
        };
      }
      const normalizedActive = resolve(activeDirectory);
      const candidates = await buildScanCandidates(state, normalizedActive);
      const outcomes = await mapConcurrent(candidates, SCAN_CONCURRENCY, (candidate) =>
        scanCandidate(state, api, candidate),
      );
      return mergeScanOutcomes(outcomes, activeDirectory, normalizedActive, activeSessionID);
    },
    listProjects: (activeDirectory) => listStoreProjects(state, activeDirectory),
    listDirectories: (targetPath, anchorDirectory) =>
      listStoreDirectories(state, targetPath, anchorDirectory),
  };
};
