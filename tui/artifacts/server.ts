import {
  type ArtifactListResult,
  type ArtifactReadResult,
  type ArtifactScope,
  type ArtifactStore,
  type ArtifactStoreClient,
  type ArtifactSummary,
  classifyClientFailure,
  type DirectoryEntry,
  type DirectoryListingResult,
  defaultHomeDirectory,
  folderNameOf,
  type KnownProjectSeed,
  type KnownSessionSeed,
  makeClientArtifactStore,
  type ProjectTarget,
  parentDirectoryOf,
  type ResolvedArtifactStore,
  resolveDirectoryPath,
  withStoreDefaults,
} from "./store.ts";

export {
  type ArtifactListResult,
  type ArtifactReadResult,
  type ArtifactScope,
  type ArtifactStore,
  type ArtifactStoreClient,
  type ArtifactSummary,
  classifyClientFailure,
  type DirectoryEntry,
  type DirectoryListingResult,
  defaultHomeDirectory,
  folderNameOf,
  type KnownProjectSeed,
  type KnownSessionSeed,
  makeClientArtifactStore,
  type ProjectTarget,
  parentDirectoryOf,
  type ResolvedArtifactStore,
  resolveDirectoryPath,
  withStoreDefaults,
};

export type GalleryUrlOptions = {
  readonly scope?: "current" | "all" | undefined;
  readonly directory?: string | undefined;
};

export type GalleryServer = {
  readonly origin: string;
  readonly port: number;
  readonly galleryUrl: (artifactID?: string, options?: GalleryUrlOptions) => string;
  readonly standaloneUrl: (artifactID: string) => string;
  readonly stop: () => void;
};

const ARTIFACT_ID = /^art_[A-Za-z0-9_-]+$/;

const decodePathPart = (part: string): ReadonlyArray<string> | undefined => {
  try {
    const decoded = decodeURIComponent(part);
    if (decoded.includes("\0") || decoded.includes("\\")) return undefined;
    const pieces = decoded.split("/");
    return pieces.some((piece) => piece.length === 0 || piece === "." || piece === "..")
      ? undefined
      : pieces;
  } catch {
    return undefined;
  }
};

export const normalizeSubpath = (raw: string): string | undefined => {
  const cleaned = raw
    .replaceAll("\\", "/")
    .replace(/^(?:\.\/)+/u, "")
    .replace(/^\/+/u, "");
  if (cleaned.length === 0 || cleaned.includes("\0")) return undefined;

  const segments: Array<string> = [];
  for (const part of cleaned.split("/")) {
    const pieces = decodePathPart(part);
    if (pieces === undefined) return undefined;
    segments.push(...pieces);
  }
  return segments.length === 0 ? undefined : segments.join("/");
};

export const contentTypeFor = (filePath: string): string => {
  const detected = Bun.file(filePath).type;
  if (detected.startsWith("text/") && !detected.includes("charset=")) {
    return `${detected}; charset=utf-8`;
  }
  return detected || "text/plain; charset=utf-8";
};

const MARKDOWN_CSS = `:root {
  color-scheme: light dark;
  --bg: #fbfbf9; --surface: #f3f3ef; --fg: #191917; --muted: #55554f; --border: #c9c9c1; --accent: #7a4b00;
  --font: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #161615; --surface: #1f1f1d; --fg: #ecece7; --muted: #a8a8a0; --border: #44443f; --accent: #f0b45e; }
}
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 1rem/1.65 var(--font); }
main { max-width: 78ch; margin: 0 auto; padding: 2.5rem 1.5rem 4rem; }
pre, code { font-family: var(--mono); }
code { background: var(--surface); padding: 0.1em 0.3em; border-radius: 3px; font-size: 0.9em; }
pre { background: var(--surface); border: 1px solid var(--border); padding: 1rem; border-radius: 6px; overflow-x: auto; }
pre code { background: none; padding: 0; }
a { color: var(--fg); text-decoration-color: var(--accent); }
table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
th, td { border: 1px solid var(--border); padding: 0.45rem 0.65rem; text-align: left; }`;

const markdownDocument = (title: string, markdown: string): string => {
  const rendered = Bun.markdown.html(markdown, { noHtmlBlocks: true, noHtmlSpans: true });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${Bun.escapeHTML(title)}</title><style>${MARKDOWN_CSS}</style></head><body><main>${rendered}</main></body></html>`;
};

const GALLERY_CSS_A = `:root {
  color-scheme: light dark;
  --font: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  --bg: #fbfbf9; --surface: #f3f3ef; --surface-alt: #e8e8e2; --fg: #191917;
  --muted: #55554f; --border: #c9c9c1; --accent: #7a4b00; --accent-bg: rgba(122, 75, 0, 0.1);
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #161615; --surface: #1f1f1d; --surface-alt: #292927; --fg: #ecece7;
    --muted: #a8a8a0; --border: #44443f; --accent: #f0b45e; --accent-bg: rgba(240, 180, 94, 0.14);
  }
}
*, *::before, *::after { box-sizing: border-box; }
[hidden] { display: none !important; }
html, body { height: 100%; margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.45 var(--font); }
.shell { display: grid; grid-template-columns: 22rem 1fr; height: 100dvh; width: 100vw; overflow: hidden; }
.shell.collapsed { grid-template-columns: 0 1fr; }
.shell.collapsed .sidebar { visibility: hidden; border-right: 0; }
.sidebar { display: flex; flex-direction: column; background: var(--surface); border-right: 1px solid var(--border); min-width: 0; overflow: hidden; }
.brand { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; padding: 0.75rem 0.9rem 0.55rem; border-bottom: 1px solid var(--border); }
.brand-title { font-weight: 650; letter-spacing: 0.01em; display: flex; align-items: center; gap: 0.45rem; }
.count { font: 600 11px/1.4 var(--mono); padding: 0.05rem 0.45rem; border-radius: 999px; border: 1px solid var(--border); color: var(--muted); }
.controls { display: flex; flex-direction: column; gap: 0.45rem; padding: 0.65rem 0.75rem; border-bottom: 1px solid var(--border); }
.loc-row { display: flex; gap: 0.35rem; align-items: stretch; }
.loc-btn { flex: 1; min-width: 0; appearance: none; border: 1px solid var(--border); background: var(--bg); color: var(--fg); border-radius: 5px; padding: 0.32rem 0.55rem; font: 600 12px/1.3 var(--font); cursor: pointer; display: flex; align-items: center; justify-content: space-between; gap: 0.4rem; text-align: left; }
.loc-btn:hover, .loc-btn[aria-expanded="true"] { border-color: var(--accent); }
.loc-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }`;

const GALLERY_CSS_B = `.loc-drawer { display: flex; flex-direction: column; gap: 0.45rem; padding: 0.55rem; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); max-height: 19rem; }
.drawer-tabs, .scope-row, .fs-bar { display: flex; gap: 0.35rem; flex-wrap: wrap; }
.fs-bar { flex-wrap: nowrap; }
.drawer-pane { display: flex; flex-direction: column; gap: 0.4rem; min-height: 0; }
.drawer-list { overflow-y: auto; max-height: 12rem; display: flex; flex-direction: column; gap: 0.15rem; }
.drawer-item { width: 100%; text-align: left; border: 1px solid transparent; background: transparent; color: var(--fg); padding: 0.38rem 0.5rem; border-radius: 5px; cursor: pointer; display: flex; flex-direction: column; gap: 0.1rem; font: 12.5px/1.3 var(--font); }
.drawer-item:hover, .item:hover { background: var(--surface-alt); }
.drawer-item[aria-current="true"], .item[aria-selected="true"] { border-color: var(--accent); background: var(--accent-bg); }
.drawer-item-top { display: flex; justify-content: space-between; align-items: center; gap: 0.4rem; font-weight: 600; }
.drawer-item-path { color: var(--muted); font: 11px/1.3 var(--mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fs-row { display: flex; align-items: center; gap: 0.25rem; }
.fs-row .drawer-item { flex: 1; min-width: 0; }
input[type="search"], input[type="text"] { width: 100%; min-width: 0; padding: 0.4rem 0.55rem; border-radius: 5px; border: 1px solid var(--border); background: var(--bg); color: var(--fg); font: inherit; }
.fs-bar input[type="text"] { font: 11.5px/1.3 var(--mono); padding: 0.32rem 0.45rem; }
input:focus, button:focus-visible, a:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.pill, .btn { appearance: none; border: 1px solid var(--border); background: var(--bg); color: var(--fg); border-radius: 5px; padding: 0.28rem 0.55rem; font: 500 12px/1.3 var(--font); cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; gap: 0.3rem; white-space: nowrap; }
.pill:hover, .btn:hover, .mono-badge:hover { border-color: var(--accent); color: var(--fg); }
.pill[aria-pressed="true"] { border-color: var(--accent); background: var(--accent-bg); font-weight: 600; }
.list { flex: 1; overflow-y: auto; padding: 0.4rem; display: flex; flex-direction: column; gap: 0.25rem; }
.item { width: 100%; text-align: left; border: 1px solid transparent; background: transparent; color: var(--fg); padding: 0.55rem 0.65rem; border-radius: 6px; cursor: pointer; display: flex; flex-direction: column; gap: 0.2rem; }
.item-title { font-weight: 600; font-size: 13px; overflow-wrap: anywhere; }
.item-meta { display: flex; justify-content: space-between; gap: 0.5rem; color: var(--muted); font-size: 11.5px; font-family: var(--mono); }
.item-sub { color: var(--muted); font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.stage { display: flex; flex-direction: column; min-width: 0; height: 100dvh; background: var(--bg); }
.toolbar { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; padding: 0.5rem 0.85rem; border-bottom: 1px solid var(--border); background: var(--surface); min-height: 2.75rem; }
.toolbar-left, .toolbar-right { display: flex; align-items: center; gap: 0.5rem; min-width: 0; }
.active-title { font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mono-badge { font: 11.5px/1.3 var(--mono); color: var(--muted); background: var(--bg); border: 1px solid var(--border); border-radius: 4px; padding: 0.15rem 0.45rem; cursor: pointer; }
.viewer { flex: 1; width: 100%; border: 0; background: var(--bg); }
.empty { margin: auto; max-width: 32rem; padding: 1.5rem; text-align: center; color: var(--muted); }
.empty h2 { margin: 0 0 0.4rem; color: var(--fg); font-size: 1rem; }
@media (max-width: 760px) {
  .shell { grid-template-columns: 1fr; grid-template-rows: 16rem 1fr; }
  .shell.collapsed { grid-template-rows: 0 1fr; }
  .sidebar { border-right: 0; border-bottom: 1px solid var(--border); }
}`;

const GALLERY_MARKUP = `<div class="shell" id="shell">
  <aside class="sidebar" aria-label="Artifact list">
    <div class="brand">
      <div class="brand-title"><span>Spectre Artifacts</span><span class="count" id="count">0</span></div>
      <button type="button" class="btn" id="refreshBtn" title="Refresh list (r)">Refresh</button>
    </div>
    <div class="controls">
      <div class="loc-row">
        <button type="button" class="loc-btn" id="projectPickerBtn" aria-expanded="false" title="Select project or browse filesystem (p)">
          <span class="loc-label" id="projectPickerLabel">Current project</span>
          <span aria-hidden="true">▾</span>
        </button>
        <button type="button" class="pill" id="allProjectsBtn" aria-pressed="false" title="Toggle all projects (a)">All projects</button>
      </div>
      <div class="loc-drawer" id="locationDrawer" hidden>
        <div class="drawer-tabs">
          <button type="button" class="pill" id="tabProjects" aria-pressed="true">Projects</button>
          <button type="button" class="pill" id="tabFs" aria-pressed="false">Filesystem</button>
        </div>
        <div class="drawer-pane" id="projectsPane">
          <input type="search" id="projectSearchInput" placeholder="Filter projects or paste /path..." autocomplete="off">
          <div class="drawer-list" id="projectList"></div>
        </div>
        <div class="drawer-pane" id="fsPane" hidden>
          <form class="fs-bar" id="fsForm">
            <input type="text" id="fsPathInput" placeholder="/path/to/folder" spellcheck="false" autocomplete="off">
            <button type="submit" class="btn">Go</button>
            <button type="button" class="btn" id="fsOpenHereBtn" title="View artifacts in this folder">Open</button>
          </form>
          <div class="drawer-list" id="fsList"></div>
        </div>
      </div>
      <input type="search" id="searchInput" placeholder="Search title, art_ id, project, session... (/)" autocomplete="off">
      <div class="scope-row" id="scopeRow" hidden>
        <button type="button" class="pill" data-scope="all" aria-pressed="true">All sessions</button>
        <button type="button" class="pill" data-scope="session" aria-pressed="false">Current session</button>
      </div>
    </div>
    <div class="list" id="list" role="listbox" aria-label="Published artifacts"></div>
  </aside>
  <section class="stage">
    <header class="toolbar">
      <div class="toolbar-left">
        <button type="button" class="btn" id="toggleSidebarBtn" title="Toggle sidebar ([)">Sidebar</button>
        <span class="active-title" id="activeTitle">Select an artifact</span>
        <button type="button" class="mono-badge" id="copyIdBtn" hidden title="Copy artifact ID"></button>
      </div>
      <div class="toolbar-right">
        <span class="mono-badge" id="kindBadge" hidden></span>
        <button type="button" class="btn" id="reloadFrameBtn" hidden title="Reload active artifact">Reload</button>
        <a class="btn" id="standaloneLink" href="#" target="_blank" rel="noopener" hidden>Standalone</a>
      </div>
    </header>
    <div class="empty" id="emptyState"><h2 id="emptyHeading">Loading artifacts...</h2><p id="emptyBody"></p></div>
    <iframe class="viewer" id="viewer" sandbox="allow-scripts allow-downloads" title="Artifact preview" hidden></iframe>
  </section>
</div>`;

const GALLERY_JS_CORE = `const $ = (id) => document.getElementById(id);
const el = (tag, props, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
const shell = $("shell"), countEl = $("count"), searchInput = $("searchInput"), scopeRow = $("scopeRow");
const projectPickerBtn = $("projectPickerBtn"), projectPickerLabel = $("projectPickerLabel"), allProjectsBtn = $("allProjectsBtn");
const locationDrawer = $("locationDrawer"), tabProjects = $("tabProjects"), tabFs = $("tabFs");
const projectsPane = $("projectsPane"), projectSearchInput = $("projectSearchInput"), projectList = $("projectList");
const fsPane = $("fsPane"), fsForm = $("fsForm"), fsPathInput = $("fsPathInput"), fsOpenHereBtn = $("fsOpenHereBtn"), fsList = $("fsList");
const listEl = $("list"), activeTitle = $("activeTitle"), copyIdBtn = $("copyIdBtn"), kindBadge = $("kindBadge");
const reloadFrameBtn = $("reloadFrameBtn"), standaloneLink = $("standaloneLink");
const emptyState = $("emptyState"), emptyHeading = $("emptyHeading"), emptyBody = $("emptyBody"), viewer = $("viewer");

const initParams = new URLSearchParams(location.search);
let allItems = [], knownProjects = [], activeDirectory = "", activeProjectName = "Current project";
let activeSessionID, sessionFilter = "all", frameNonce = 0, currentLoadedDirectory = "", currentFsDirectory = "";
let targetScope = initParams.get("scope") === "all" ? { kind: "all" } : (initParams.get("directory") ? { kind: "directory", directory: initParams.get("directory") } : { kind: "current" });
let selectedId = initParams.get("select") || undefined;

const baseName = (dir) => {
  if (!dir) return "";
  const trimmed = dir.replace(/[\\\\/]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\\\"));
  return idx === -1 ? (trimmed || dir) : (trimmed.slice(idx + 1) || dir);
};
const relativeTime = (ms) => {
  const sec = Math.floor(Math.max(0, Date.now() - ms) / 1000);
  if (sec < 60) return "just now";
  if (sec < 3600) return Math.floor(sec / 60) + "m ago";
  return sec < 86400 ? Math.floor(sec / 3600) + "h ago" : Math.floor(sec / 86400) + "d ago";
};
const filteredItems = () => {
  const tokens = searchInput.value.trim().toLowerCase().split(/\\s+/).filter(Boolean);
  return allItems.filter((item) => {
    if (sessionFilter === "session" && activeSessionID && item.sessionID !== activeSessionID) return false;
    const hay = [item.title, item.id, item.entry, item.provider, item.projectName || "", item.projectDirectory || "", item.sessionTitle || "", item.sessionID || ""].join(" ").toLowerCase();
    return tokens.every((tok) => hay.includes(tok));
  });
};`;

const GALLERY_JS_RENDER = `const syncUrl = (id) => {
  const next = new URL(location.href);
  next.searchParams.delete("scope"); next.searchParams.delete("directory");
  if (targetScope.kind === "all") next.searchParams.set("scope", "all");
  else if (targetScope.kind === "directory" && targetScope.directory) next.searchParams.set("directory", targetScope.directory);
  if (id) next.searchParams.set("select", id); else next.searchParams.delete("select");
  history.replaceState(null, "", next);
};
const updateTargetHeader = (labelHint, directoryHint) => {
  allProjectsBtn.setAttribute("aria-pressed", String(targetScope.kind === "all"));
  if (targetScope.kind === "all") { projectPickerLabel.textContent = "All projects"; projectPickerBtn.title = "Viewing canvases across all projects (p)"; return; }
  const dir = directoryHint || (targetScope.kind === "directory" ? targetScope.directory : activeDirectory);
  projectPickerLabel.textContent = labelHint || baseName(dir) || "Current project";
  projectPickerBtn.title = dir ? dir + " (p)" : "Select project or browse filesystem (p)";
};
const showMessage = (heading, body) => {
  viewer.hidden = true; emptyState.hidden = false; emptyHeading.textContent = heading; emptyBody.textContent = body;
  copyIdBtn.hidden = kindBadge.hidden = reloadFrameBtn.hidden = standaloneLink.hidden = true;
};
const renderList = () => {
  const visible = filteredItems();
  countEl.textContent = String(visible.length); listEl.replaceChildren();
  for (const item of visible) {
    const subParts = [];
    if (targetScope.kind === "all" && (item.projectName || item.projectDirectory)) subParts.push(item.projectName || baseName(item.projectDirectory));
    if (item.sessionTitle) subParts.push(item.sessionTitle);
    subParts.push(item.entry);
    const btn = el("button", { type: "button", className: "item" },
      el("div", { className: "item-title", textContent: item.title }),
      el("div", { className: "item-meta" }, el("span", { textContent: item.id }), el("span", { textContent: relativeTime(item.updatedAt) })),
      el("div", { className: "item-sub", textContent: subParts.join(" · ") }),
    );
    btn.setAttribute("role", "option"); btn.setAttribute("aria-selected", String(item.id === selectedId));
    btn.addEventListener("click", () => selectArtifact(item.id));
    listEl.append(btn);
  }
};`;

const GALLERY_JS_LOAD = `const selectArtifact = (id, forceReload = false) => {
  const chosen = filteredItems().find((item) => item.id === id) || allItems.find((item) => item.id === id);
  if (!chosen) {
    selectedId = undefined; syncUrl(undefined); activeTitle.textContent = "No artifact selected";
    const emptyHint = targetScope.kind === "all" ? "Publish a canvas or artifact in OpenCode, then click Refresh." : "Switch to All projects, pick another project/folder above, or publish a canvas here.";
    showMessage(allItems.length === 0 ? "No artifacts in this scope" : "No matching artifacts", allItems.length === 0 ? emptyHint : "Clear the search filter or switch session scope.");
    renderList(); return;
  }
  const changed = selectedId !== chosen.id;
  selectedId = chosen.id; syncUrl(chosen.id); activeTitle.textContent = chosen.title;
  copyIdBtn.textContent = chosen.id; copyIdBtn.hidden = reloadFrameBtn.hidden = standaloneLink.hidden = false;
  const baseHref = "/" + encodeURIComponent(chosen.id) + "/";
  const dir = chosen.projectDirectory || (targetScope.kind === "directory" ? targetScope.directory : "");
  const dirParam = dir ? "directory=" + encodeURIComponent(dir) : "";
  standaloneLink.href = dirParam ? baseHref + "?" + dirParam : baseHref;
  emptyState.hidden = true; viewer.hidden = false;
  if (changed || forceReload || !viewer.getAttribute("src")) {
    viewer.src = baseHref + "?v=" + (++frameNonce) + (dirParam ? "&" + dirParam : "");
    kindBadge.hidden = true;
    fetch(baseHref + ".spectre-canvas.json" + (dirParam ? "?" + dirParam : ""), { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((meta) => {
        if (meta && typeof meta.kind === "string" && selectedId === chosen.id) {
          kindBadge.textContent = meta.kind.toUpperCase();
          kindBadge.hidden = false;
        }
      })
      .catch(() => {});
  }
  renderList();
};
const loadArtifacts = async (forceReload = false) => {
  try {
    const apiUrl = targetScope.kind === "all" ? "/api/artifacts?scope=all" : (targetScope.kind === "directory" && targetScope.directory ? "/api/artifacts?directory=" + encodeURIComponent(targetScope.directory) : "/api/artifacts");
    const data = await (await fetch(apiUrl, { cache: "no-store" })).json();
    if (data.status === "disabled") {
      allItems = []; countEl.textContent = "0"; listEl.replaceChildren(); activeTitle.textContent = "Artifacts disabled";
      updateTargetHeader(undefined, data.directory);
      showMessage("Experimental artifacts are disabled", "Enable experimental.artifacts: true in opencode.json or set OPENCODE_FLAGS=artifacts.");
      return;
    }
    if (data.status !== "ok") {
      allItems = []; countEl.textContent = "0"; listEl.replaceChildren(); updateTargetHeader(undefined, data.directory);
      showMessage("Could not load artifacts", data.message || "Unknown server error."); return;
    }
    allItems = Array.isArray(data.items) ? data.items : [];
    currentLoadedDirectory = data.directory || "";
    if (data.activeDirectory) activeDirectory = data.activeDirectory;
    else if (targetScope.kind === "current" && data.directory) activeDirectory = data.directory;
    activeSessionID = data.sessionID; scopeRow.hidden = !activeSessionID;
    if (!activeSessionID && sessionFilter === "session") sessionFilter = "all";
    const inferredLabel = data.projectName || (allItems[0] && allItems[0].projectName) || baseName(data.directory);
    if (targetScope.kind === "current" && inferredLabel) activeProjectName = inferredLabel;
    updateTargetHeader(inferredLabel, data.directory);
    const visible = filteredItems();
    selectArtifact((selectedId && allItems.some((item) => item.id === selectedId) ? selectedId : undefined) || (visible[0] && visible[0].id), forceReload);
  } catch (err) { showMessage("Gallery connection lost", err instanceof Error ? err.message : String(err)); }
};`;

const GALLERY_JS_DRAWER = `const makeDrawerRow = (titleText, badgeText, pathText, isCurrent, onClick) => {
  const top = el("div", { className: "drawer-item-top" }, el("span", { textContent: titleText }));
  if (badgeText) top.append(el("span", { className: "count", textContent: badgeText }));
  const btn = el("button", { type: "button", className: "drawer-item" }, top);
  if (isCurrent) btn.setAttribute("aria-current", "true");
  if (pathText) btn.append(el("div", { className: "drawer-item-path", textContent: pathText }));
  btn.addEventListener("click", onClick);
  return btn;
};
const setDrawerOpen = (open) => {
  locationDrawer.hidden = !open; projectPickerBtn.setAttribute("aria-expanded", String(open));
  if (!open) return;
  if (!fsPane.hidden) { void loadFilesystem(currentFsDirectory || currentLoadedDirectory || activeDirectory); fsPathInput.focus(); }
  else { void refreshProjects(); projectSearchInput.focus(); }
};
const switchDrawerTab = (mode) => {
  const isFs = mode === "fs";
  tabProjects.setAttribute("aria-pressed", String(!isFs)); tabFs.setAttribute("aria-pressed", String(isFs));
  projectsPane.hidden = isFs; fsPane.hidden = !isFs;
  if (isFs) { void loadFilesystem(currentFsDirectory || currentLoadedDirectory || activeDirectory); fsPathInput.focus(); }
  else { void refreshProjects(); projectSearchInput.focus(); }
};
const applyTargetScope = (nextScope) => { targetScope = nextScope; setDrawerOpen(false); syncUrl(selectedId); void loadArtifacts(false); };
const renderProjectList = () => {
  const query = projectSearchInput.value.trim().toLowerCase();
  projectList.replaceChildren();
  if (!query || "all projects".includes(query)) projectList.append(makeDrawerRow("All projects", "all", "Every project in OpenCode", targetScope.kind === "all", () => applyTargetScope({ kind: "all" })));
  if (!query || "browse filesystem folders".includes(query)) projectList.append(makeDrawerRow("Browse filesystem…", "folders", currentLoadedDirectory || activeDirectory || "/", false, () => switchDrawerTab("fs")));
  for (const proj of knownProjects) {
    if (query && !(proj.name + " " + proj.directory + " " + (proj.kind || "")).toLowerCase().includes(query)) continue;
    const isSelected = (targetScope.kind === "current" && proj.isCurrent) || (targetScope.kind === "directory" && targetScope.directory === proj.directory);
    const badge = proj.isCurrent ? "current" : (proj.kind === "worktree" ? "worktree" : proj.kind === "custom" ? "custom" : "");
    projectList.append(makeDrawerRow(proj.name, badge, proj.directory, isSelected, () => applyTargetScope(proj.isCurrent ? { kind: "current" } : { kind: "directory", directory: proj.directory })));
  }
  const raw = projectSearchInput.value.trim();
  if (raw && (raw.startsWith("/") || raw.startsWith("~") || raw.startsWith("."))) projectList.append(makeDrawerRow("Open path: " + raw, "path", raw, false, () => applyTargetScope({ kind: "directory", directory: raw })));
};`;

const GALLERY_JS_EVENTS = `const refreshProjects = async () => {
  try {
    const data = await (await fetch("/api/projects", { cache: "no-store" })).json();
    if (data.status === "ok" && Array.isArray(data.projects)) {
      knownProjects = data.projects;
      if (data.activeDirectory) activeDirectory = data.activeDirectory;
      if (data.projectName) activeProjectName = data.projectName;
      if (targetScope.kind === "current") updateTargetHeader(activeProjectName, activeDirectory);
    }
  } catch (err) { console.warn(err); }
  renderProjectList();
};
const loadFilesystem = async (targetPath) => {
  fsList.replaceChildren();
  try {
    const data = await (await fetch(targetPath ? "/api/fs?path=" + encodeURIComponent(targetPath) : "/api/fs", { cache: "no-store" })).json();
    if (data.status !== "ok") { fsList.append(makeDrawerRow("Could not read folder", "error", data.message || targetPath || "", false, () => {})); return; }
    currentFsDirectory = data.directory; fsPathInput.value = data.directory;
    fsList.append(makeDrawerRow("Use this directory (" + (baseName(data.directory) || data.directory) + ")", "open", data.directory, false, () => applyTargetScope(data.directory === activeDirectory ? { kind: "current" } : { kind: "directory", directory: data.directory })));
    if (data.parent) fsList.append(makeDrawerRow("..", "parent", data.parent, false, () => void loadFilesystem(data.parent)));
    if (data.home && data.home !== data.directory) fsList.append(makeDrawerRow("~", "home", data.home, false, () => void loadFilesystem(data.home)));
    for (const entry of Array.isArray(data.entries) ? data.entries : []) {
      const openBtn = el("button", { type: "button", className: "btn", textContent: "Open", title: "Open canvases in " + entry.directory });
      openBtn.addEventListener("click", () => applyTargetScope(entry.directory === activeDirectory ? { kind: "current" } : { kind: "directory", directory: entry.directory }));
      fsList.append(el("div", { className: "fs-row" }, makeDrawerRow(entry.name + "/", "", entry.directory, false, () => void loadFilesystem(entry.directory)), openBtn));
    }
  } catch (err) { fsList.append(makeDrawerRow("Filesystem error", "error", err instanceof Error ? err.message : String(err), false, () => {})); }
};
projectPickerBtn.addEventListener("click", () => setDrawerOpen(locationDrawer.hidden));
allProjectsBtn.addEventListener("click", () => applyTargetScope(targetScope.kind === "all" ? { kind: "current" } : { kind: "all" }));
tabProjects.addEventListener("click", () => switchDrawerTab("projects"));
tabFs.addEventListener("click", () => switchDrawerTab("fs"));
projectSearchInput.addEventListener("input", renderProjectList);
projectSearchInput.addEventListener("keydown", (e) => { const raw = projectSearchInput.value.trim(); if (e.key === "Enter" && (raw.startsWith("/") || raw.startsWith("~") || raw.startsWith("."))) { e.preventDefault(); applyTargetScope({ kind: "directory", directory: raw }); } });
fsForm.addEventListener("submit", (e) => { e.preventDefault(); const raw = fsPathInput.value.trim(); if (raw) void loadFilesystem(raw); });
fsOpenHereBtn.addEventListener("click", () => { const raw = fsPathInput.value.trim() || currentFsDirectory; if (raw) applyTargetScope(raw === activeDirectory ? { kind: "current" } : { kind: "directory", directory: raw }); });
searchInput.addEventListener("input", () => { const v = filteredItems(); if (selectedId && v.some((i) => i.id === selectedId)) renderList(); else selectArtifact(v[0] && v[0].id); });
for (const pill of scopeRow.querySelectorAll("[data-scope]")) pill.addEventListener("click", () => { sessionFilter = pill.getAttribute("data-scope") || "all"; for (const o of scopeRow.querySelectorAll("[data-scope]")) o.setAttribute("aria-pressed", String(o === pill)); const v = filteredItems(); if (!selectedId || !v.some((i) => i.id === selectedId)) selectArtifact(v[0] && v[0].id); else renderList(); });
$("refreshBtn").addEventListener("click", () => void loadArtifacts(false));
reloadFrameBtn.addEventListener("click", () => void loadArtifacts(true));
$("toggleSidebarBtn").addEventListener("click", () => shell.classList.toggle("collapsed"));
copyIdBtn.addEventListener("click", () => { if (!selectedId || !navigator.clipboard) return; void navigator.clipboard.writeText(selectedId).then(() => { const s = copyIdBtn.textContent; copyIdBtn.textContent = "Copied"; setTimeout(() => { if (copyIdBtn.textContent === "Copied") copyIdBtn.textContent = s; }, 900); }); });
document.addEventListener("keydown", (e) => {
  const activeEl = document.activeElement, inInput = activeEl === searchInput || activeEl === projectSearchInput || activeEl === fsPathInput;
  if (e.key === "Escape") { if (!locationDrawer.hidden) { e.preventDefault(); setDrawerOpen(false); return; } if (activeEl === searchInput) { if (searchInput.value) { searchInput.value = ""; searchInput.dispatchEvent(new Event("input")); } else searchInput.blur(); return; } }
  if (e.key === "/" && !inInput && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); searchInput.focus(); searchInput.select(); return; }
  if (inInput || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === "[") { e.preventDefault(); shell.classList.toggle("collapsed"); return; }
  if (e.key === "r") { e.preventDefault(); void loadArtifacts(true); return; }
  if (e.key === "a") { e.preventDefault(); applyTargetScope(targetScope.kind === "all" ? { kind: "current" } : { kind: "all" }); return; }
  if (e.key === "p") { e.preventDefault(); setDrawerOpen(locationDrawer.hidden); return; }
  if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "j" || e.key === "k") { const v = filteredItems(); if (!v.length) return; e.preventDefault(); const d = e.key === "ArrowDown" || e.key === "j" ? 1 : -1, c = v.findIndex((i) => i.id === selectedId); selectArtifact(v[c === -1 ? 0 : (c + d + v.length) % v.length].id); }
});
void refreshProjects(); void loadArtifacts(false);`;

const GALLERY_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="data:,">
<title>Spectre Artifacts</title>
<style>
${GALLERY_CSS_A}
${GALLERY_CSS_B}
</style>
</head>
<body>
${GALLERY_MARKUP}
<script>
(() => {
${GALLERY_JS_CORE}
${GALLERY_JS_RENDER}
${GALLERY_JS_LOAD}
${GALLERY_JS_DRAWER}
${GALLERY_JS_EVENTS}
})();
</script>
</body>
</html>`;

const respond = (
  method: string,
  status: number,
  contentType: string,
  body: string,
  extraHeaders?: Readonly<Record<string, string>>,
): Response =>
  new Response(method === "HEAD" ? null : body, {
    status,
    headers: {
      "content-type": contentType,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extraHeaders,
    },
  });

const respondJson = (method: string, status: number, payload: unknown): Response =>
  respond(method, status, "application/json; charset=utf-8", JSON.stringify(payload));

const isCrossSiteFetch = (request: Request): boolean => {
  const site = request.headers.get("sec-fetch-site");
  return site === "cross-site" || site === "same-site";
};

const isAllowedLoopbackHost = (url: URL, expectedPort?: () => number): boolean => {
  if (url.hostname !== "127.0.0.1") return false;
  if (expectedPort === undefined) return true;
  const port = expectedPort();
  return port === 0 || url.host === `127.0.0.1:${port}`;
};

const statusForReadFailure = (status: "not-found" | "disabled" | "error"): number =>
  status === "not-found" ? 404 : status === "disabled" ? 403 : 502;

const renderArtifactPayload = (
  title: string,
  targetPath: string,
  fileContent: string,
  isEntryRequest: boolean,
  rawQuery: string | null,
): { readonly body: string; readonly contentType: string; readonly csp: string } => {
  const renderMarkdownHtml =
    isEntryRequest && targetPath.toLowerCase().endsWith(".md") && rawQuery !== "1";
  if (renderMarkdownHtml) {
    return {
      body: markdownDocument(title, fileContent),
      contentType: "text/html; charset=utf-8",
      csp: "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:",
    };
  }
  return {
    body: fileContent,
    contentType: contentTypeFor(targetPath),
    csp: "sandbox allow-scripts",
  };
};

export const parseArtifactsRequestScope = (url: URL): ArtifactScope => {
  if (url.searchParams.get("scope") === "all") return { kind: "all" };
  const directory = url.searchParams.get("directory")?.trim();
  return directory !== undefined && directory.length > 0
    ? { kind: "directory", directory }
    : { kind: "current" };
};

const serveArtifactsApi = async (
  method: string,
  url: URL,
  active: { readonly directory: string; readonly sessionID?: string },
  store: ResolvedArtifactStore,
): Promise<Response> => {
  const scope = parseArtifactsRequestScope(url);
  if (scope.kind === "all") {
    return respondJson(method, 200, await store.listAll(active.directory, active.sessionID));
  }
  if (scope.kind === "directory") {
    const resolvedActive = resolveDirectoryPath(active.directory, active.directory);
    const resolvedTarget = resolveDirectoryPath(
      scope.directory,
      active.directory,
      defaultHomeDirectory(),
    );
    const sessionID = resolvedTarget === resolvedActive ? active.sessionID : undefined;
    const listed = await store.list(resolvedTarget, sessionID);
    if (listed.status !== "ok") return respondJson(method, 200, listed);
    return respondJson(method, 200, {
      ...listed,
      scope: "directory",
      activeDirectory: active.directory,
      projectName: listed.items[0]?.projectName ?? folderNameOf(resolvedTarget),
    });
  }
  return respondJson(method, 200, await store.list(active.directory, active.sessionID));
};

const serveApiRoute = async (
  method: string,
  request: Request,
  url: URL,
  active: { readonly directory: string; readonly sessionID?: string },
  store: ResolvedArtifactStore,
): Promise<Response> => {
  if (isCrossSiteFetch(request)) {
    return respondJson(method, 403, {
      status: "error",
      message: "Cross-site requests are not allowed",
    });
  }
  if (url.pathname === "/api/artifacts") return serveArtifactsApi(method, url, active, store);
  if (url.pathname === "/api/projects") {
    const projects = await store.listProjects(active.directory);
    const current = projects.find((entry) => entry.isCurrent);
    return respondJson(method, 200, {
      status: "ok",
      activeDirectory: active.directory,
      projectName: current?.name ?? folderNameOf(active.directory),
      projects,
    });
  }
  if (url.pathname === "/api/fs") {
    const rawPath = url.searchParams.get("path") ?? active.directory;
    return respondJson(method, 200, await store.listDirectories(rawPath, active.directory));
  }
  return respondJson(method, 404, { status: "error", message: "Not found" });
};

const serveArtifactRoute = async (
  method: string,
  url: URL,
  directory: string,
  store: ResolvedArtifactStore,
): Promise<Response> => {
  const slash = url.pathname.indexOf("/", 1);
  const rawFirst = slash === -1 ? url.pathname.slice(1) : url.pathname.slice(1, slash);
  let artifactID: string;
  try {
    artifactID = decodeURIComponent(rawFirst);
  } catch {
    return respond(method, 400, "text/plain; charset=utf-8", "Malformed artifact path");
  }

  if (!ARTIFACT_ID.test(artifactID)) {
    return respond(method, 404, "text/plain; charset=utf-8", "Not found");
  }

  const canonicalId = encodeURIComponent(artifactID);
  if (slash === -1 || rawFirst !== canonicalId) {
    const rest = slash === -1 ? "" : url.pathname.slice(slash + 1);
    return new Response(null, {
      status: 308,
      headers: { location: `/${canonicalId}/${rest}${url.search}` },
    });
  }

  const found = await store.get(artifactID, directory);
  if (found.status !== "ok") {
    return respond(
      method,
      statusForReadFailure(found.status),
      "text/plain; charset=utf-8",
      found.message,
    );
  }

  const rawSubpath = url.pathname.slice(slash + 1);
  const isEntryRequest = rawSubpath.length === 0;
  const targetPath = normalizeSubpath(isEntryRequest ? found.entry : rawSubpath);
  if (targetPath === undefined) {
    return respond(method, 400, "text/plain; charset=utf-8", "Invalid artifact file path");
  }

  const fileContent = Object.hasOwn(found.files, targetPath) ? found.files[targetPath] : undefined;
  if (fileContent === undefined) {
    return respond(
      method,
      404,
      "text/plain; charset=utf-8",
      `Artifact file not found: ${targetPath}`,
    );
  }

  const payload = renderArtifactPayload(
    found.title,
    targetPath,
    fileContent,
    isEntryRequest,
    url.searchParams.get("raw"),
  );
  return respond(method, 200, payload.contentType, payload.body, {
    "content-security-policy": payload.csp,
  });
};

export const formatGalleryUrl = (
  origin: string,
  artifactID?: string,
  options?: GalleryUrlOptions,
): string => {
  const params = new URLSearchParams();
  if (options?.scope === "all") {
    params.set("scope", "all");
  } else if (options?.directory !== undefined && options.directory.length > 0) {
    params.set("directory", options.directory);
  }
  if (artifactID !== undefined) params.set("select", artifactID);
  const query = params.toString();
  return query.length === 0 ? `${origin}/` : `${origin}/?${query}`;
};

export const createRequestHandler = (input: {
  readonly store: ArtifactStore;
  readonly getContext: () => { readonly directory: string; readonly sessionID?: string };
  readonly expectedPort?: () => number;
}): ((request: Request) => Promise<Response>) => {
  const store = withStoreDefaults(input.store);

  return async (request: Request): Promise<Response> => {
    const method = request.method.toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      return respond("GET", 405, "text/plain; charset=utf-8", "Method not allowed");
    }

    const url = new URL(request.url);
    if (!isAllowedLoopbackHost(url, input.expectedPort)) {
      return respond(method, 403, "text/plain; charset=utf-8", "Forbidden host");
    }
    if (url.pathname === "/") {
      return respond(method, 200, "text/html; charset=utf-8", GALLERY_HTML);
    }

    const active = input.getContext();
    if (url.pathname.startsWith("/api/")) {
      return serveApiRoute(method, request, url, active, store);
    }

    const requestedDir = url.searchParams.get("directory")?.trim();
    const hintDirectory =
      requestedDir !== undefined && requestedDir.length > 0 ? requestedDir : active.directory;
    return serveArtifactRoute(method, url, hintDirectory, store);
  };
};

export const startGalleryServer = (input: {
  readonly store: ArtifactStore;
  readonly getContext: () => { readonly directory: string; readonly sessionID?: string };
}): GalleryServer => {
  let boundPort = 0;

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: createRequestHandler({
      store: input.store,
      getContext: input.getContext,
      expectedPort: () => boundPort,
    }),
  });

  boundPort = server.port ?? 0;
  const origin = `http://127.0.0.1:${boundPort}`;

  return {
    origin,
    port: boundPort,
    galleryUrl: (artifactID, options) => formatGalleryUrl(origin, artifactID, options),
    standaloneUrl: (artifactID) => `${origin}/${encodeURIComponent(artifactID)}/`,
    stop: () => {
      void server.stop(true);
    },
  };
};
