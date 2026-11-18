import type { ArtifactInfo, OpenCodeClient } from "@opencode/client";

export type ArtifactSummary = {
  readonly id: string;
  readonly title: string;
  readonly entry: string;
  readonly provider: string;
  readonly sessionID: string | undefined;
  readonly sessionTitle: string | undefined;
  readonly createdAt: number;
  readonly updatedAt: number;
};

export type ArtifactListResult =
  | {
      readonly status: "ok";
      readonly directory: string;
      readonly sessionID: string | undefined;
      readonly items: ReadonlyArray<ArtifactSummary>;
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

export type ArtifactStore = {
  readonly list: (directory: string, sessionID?: string) => Promise<ArtifactListResult>;
  readonly get: (artifactID: string, directory?: string) => Promise<ArtifactReadResult>;
};

export type GalleryServer = {
  readonly origin: string;
  readonly port: number;
  readonly galleryUrl: (artifactID?: string) => string;
  readonly standaloneUrl: (artifactID: string) => string;
  readonly stop: () => void;
};

const ARTIFACT_ID = /^art_[A-Za-z0-9_-]+$/;

const classifyClientFailure = (
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
  if (tag === "ArtifactNotFoundError" || status === 404) return { kind: "not-found", message };
  if (tag === "LocationNotFoundError") return { kind: "location-missing", message };
  return { kind: "error", message };
};

const fetchArtifactWithFallback = async (
  api: NonNullable<OpenCodeClient["experimental"]["artifacts"]>,
  artifactID: string,
  directory?: string,
): Promise<ArtifactReadResult> => {
  try {
    const response = await api.get(
      directory === undefined ? { artifactID } : { artifactID, location: { directory } },
    );
    const { info, files } = response.data;
    return { status: "ok", id: info.id, title: info.title, entry: info.entry, files };
  } catch (cause) {
    const failure = classifyClientFailure(cause);
    if (
      directory !== undefined &&
      (failure.kind === "not-found" || failure.kind === "location-missing")
    ) {
      return fetchArtifactWithFallback(api, artifactID, undefined);
    }
    if (failure.kind === "disabled") return { status: "disabled", message: failure.message };
    if (failure.kind === "not-found") return { status: "not-found", message: failure.message };
    return { status: "error", message: failure.message };
  }
};

export const makeClientArtifactStore = (input: {
  readonly client: Pick<OpenCodeClient, "experimental">;
  readonly sessionTitle?: (sessionID: string) => string | undefined;
}): ArtifactStore => {
  const sessionTitleOf = input.sessionTitle ?? (() => undefined);

  return {
    list: async (directory, sessionID) => {
      const api = input.client.experimental?.artifacts;
      if (api === undefined) {
        return { status: "disabled", directory, message: "Artifacts API is unavailable" };
      }
      try {
        const response = await api.list({ location: { directory } });
        const items: Array<ArtifactSummary> = response.data
          .map((info: ArtifactInfo) => ({
            id: info.id,
            title: info.title,
            entry: info.entry,
            provider: info.provider,
            sessionID: info.sessionID,
            sessionTitle: info.sessionID === undefined ? undefined : sessionTitleOf(info.sessionID),
            createdAt: info.time.created,
            updatedAt: info.time.updated,
          }))
          .toSorted(
            (left, right) => right.updatedAt - left.updatedAt || right.id.localeCompare(left.id),
          );
        return { status: "ok", directory, sessionID, items };
      } catch (cause) {
        const failure = classifyClientFailure(cause);
        return failure.kind === "disabled"
          ? { status: "disabled", directory, message: failure.message }
          : { status: "error", directory, message: failure.message };
      }
    },
    get: async (artifactID, directory) => {
      const api = input.client.experimental?.artifacts;
      if (api === undefined) {
        return { status: "disabled", message: "Artifacts API is unavailable" };
      }
      return fetchArtifactWithFallback(api, artifactID, directory);
    },
  };
};

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

const markdownDocument = (title: string, markdown: string): string => {
  const rendered = Bun.markdown.html(markdown, {
    noHtmlBlocks: true,
    noHtmlSpans: true,
  });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${Bun.escapeHTML(title)}</title>
<style>
:root {
  color-scheme: light dark;
  --bg: #fbfbf9;
  --surface: #f3f3ef;
  --fg: #191917;
  --muted: #55554f;
  --border: #c9c9c1;
  --accent: #7a4b00;
  --font: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #161615;
    --surface: #1f1f1d;
    --fg: #ecece7;
    --muted: #a8a8a0;
    --border: #44443f;
    --accent: #f0b45e;
  }
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
th, td { border: 1px solid var(--border); padding: 0.45rem 0.65rem; text-align: left; }
</style>
</head>
<body>
<main>${rendered}</main>
</body>
</html>`;
};

const GALLERY_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Spectre Artifacts</title>
<style>
:root {
  color-scheme: light dark;
  --font: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  --bg: #fbfbf9;
  --surface: #f3f3ef;
  --surface-alt: #e8e8e2;
  --fg: #191917;
  --muted: #55554f;
  --border: #c9c9c1;
  --accent: #7a4b00;
  --accent-bg: rgba(122, 75, 0, 0.1);
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #161615;
    --surface: #1f1f1d;
    --surface-alt: #292927;
    --fg: #ecece7;
    --muted: #a8a8a0;
    --border: #44443f;
    --accent: #f0b45e;
    --accent-bg: rgba(240, 180, 94, 0.14);
  }
}
*, *::before, *::after { box-sizing: border-box; }
html, body { height: 100%; margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.45 var(--font); }
.shell { display: grid; grid-template-columns: 21rem 1fr; height: 100dvh; width: 100vw; overflow: hidden; }
.shell.collapsed { grid-template-columns: 0 1fr; }
.shell.collapsed .sidebar { visibility: hidden; border-right: 0; }
.sidebar { display: flex; flex-direction: column; background: var(--surface); border-right: 1px solid var(--border); min-width: 0; overflow: hidden; }
.brand { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; padding: 0.75rem 0.9rem 0.55rem; border-bottom: 1px solid var(--border); }
.brand-title { font-weight: 650; letter-spacing: 0.01em; display: flex; align-items: center; gap: 0.45rem; }
.count { font: 600 11px/1.4 var(--mono); padding: 0.05rem 0.45rem; border-radius: 999px; border: 1px solid var(--border); color: var(--muted); }
.controls { display: flex; flex-direction: column; gap: 0.5rem; padding: 0.65rem 0.75rem; border-bottom: 1px solid var(--border); }
input[type="search"] { width: 100%; padding: 0.42rem 0.6rem; border-radius: 5px; border: 1px solid var(--border); background: var(--bg); color: var(--fg); font: inherit; }
input[type="search"]:focus, button:focus-visible, a:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.scope-row { display: flex; gap: 0.35rem; }
.pill, .btn { appearance: none; border: 1px solid var(--border); background: var(--bg); color: var(--fg); border-radius: 5px; padding: 0.28rem 0.55rem; font: 500 12px/1.3 var(--font); cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; gap: 0.3rem; }
.pill:hover, .btn:hover { border-color: var(--accent); }
.pill[aria-pressed="true"] { border-color: var(--accent); background: var(--accent-bg); color: var(--fg); font-weight: 600; }
.list { flex: 1; overflow-y: auto; padding: 0.4rem; display: flex; flex-direction: column; gap: 0.25rem; }
.item { width: 100%; text-align: left; border: 1px solid transparent; background: transparent; color: var(--fg); padding: 0.55rem 0.65rem; border-radius: 6px; cursor: pointer; display: flex; flex-direction: column; gap: 0.2rem; }
.item:hover { background: var(--surface-alt); }
.item[aria-selected="true"] { background: var(--accent-bg); border-color: var(--accent); }
.item-title { font-weight: 600; font-size: 13px; overflow-wrap: anywhere; }
.item-meta { display: flex; justify-content: space-between; gap: 0.5rem; color: var(--muted); font-size: 11.5px; font-family: var(--mono); }
.item-sub { color: var(--muted); font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.stage { display: flex; flex-direction: column; min-width: 0; height: 100dvh; background: var(--bg); }
.toolbar { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; padding: 0.5rem 0.85rem; border-bottom: 1px solid var(--border); background: var(--surface); min-height: 2.75rem; }
.toolbar-left, .toolbar-right { display: flex; align-items: center; gap: 0.5rem; min-width: 0; }
.active-title { font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mono-badge { font: 11.5px/1.3 var(--mono); color: var(--muted); background: var(--bg); border: 1px solid var(--border); border-radius: 4px; padding: 0.15rem 0.45rem; cursor: pointer; }
.mono-badge:hover { border-color: var(--accent); color: var(--fg); }
.viewer { flex: 1; width: 100%; border: 0; background: var(--bg); }
.empty { margin: auto; max-width: 32rem; padding: 1.5rem; text-align: center; color: var(--muted); }
.empty h2 { margin: 0 0 0.4rem; color: var(--fg); font-size: 1rem; }
@media (max-width: 760px) {
  .shell { grid-template-columns: 1fr; grid-template-rows: 15rem 1fr; }
  .shell.collapsed { grid-template-rows: 0 1fr; }
  .sidebar { border-right: 0; border-bottom: 1px solid var(--border); }
}
</style>
</head>
<body>
<div class="shell" id="shell">
  <aside class="sidebar" aria-label="Artifact list">
    <div class="brand">
      <div class="brand-title"><span>Spectre Artifacts</span><span class="count" id="count">0</span></div>
      <button type="button" class="btn" id="refreshBtn" title="Refresh list (r)">Refresh</button>
    </div>
    <div class="controls">
      <input type="search" id="searchInput" placeholder="Search title, art_ id, session... (/)" autocomplete="off">
      <div class="scope-row" id="scopeRow" hidden>
        <button type="button" class="pill" data-scope="all" aria-pressed="true">All project</button>
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
        <button type="button" class="btn" id="reloadFrameBtn" hidden title="Reload active artifact">Reload</button>
        <a class="btn" id="standaloneLink" href="#" target="_blank" rel="noopener" hidden>Standalone</a>
      </div>
    </header>
    <div class="empty" id="emptyState"><h2 id="emptyHeading">Loading artifacts...</h2><p id="emptyBody"></p></div>
    <iframe class="viewer" id="viewer" sandbox="allow-scripts" title="Artifact preview" hidden></iframe>
  </section>
</div>
<script>
(() => {
  const $ = (id) => document.getElementById(id);
  const shell = $("shell"), countEl = $("count"), searchInput = $("searchInput"), scopeRow = $("scopeRow");
  const listEl = $("list"), activeTitle = $("activeTitle"), copyIdBtn = $("copyIdBtn");
  const reloadFrameBtn = $("reloadFrameBtn"), standaloneLink = $("standaloneLink");
  const emptyState = $("emptyState"), emptyHeading = $("emptyHeading"), emptyBody = $("emptyBody"), viewer = $("viewer");

  let allItems = [], activeSessionID, scope = "all", frameNonce = 0;
  let selectedId = new URLSearchParams(location.search).get("select") || undefined;

  const relativeTime = (ms) => {
    const sec = Math.floor(Math.max(0, Date.now() - ms) / 1000);
    if (sec < 60) return "just now";
    if (sec < 3600) return Math.floor(sec / 60) + "m ago";
    if (sec < 86400) return Math.floor(sec / 3600) + "h ago";
    return Math.floor(sec / 86400) + "d ago";
  };

  const filteredItems = () => {
    const tokens = searchInput.value.trim().toLowerCase().split(/\\s+/).filter(Boolean);
    return allItems.filter((item) => {
      if (scope === "session" && activeSessionID && item.sessionID !== activeSessionID) return false;
      const hay = [item.title, item.id, item.entry, item.provider, item.sessionTitle || "", item.sessionID || ""].join(" ").toLowerCase();
      return tokens.every((tok) => hay.includes(tok));
    });
  };

  const syncUrl = (id) => {
    const next = new URL(location.href);
    if (id) next.searchParams.set("select", id); else next.searchParams.delete("select");
    history.replaceState(null, "", next);
  };

  const showMessage = (heading, body) => {
    viewer.hidden = true; emptyState.hidden = false;
    emptyHeading.textContent = heading; emptyBody.textContent = body;
    copyIdBtn.hidden = reloadFrameBtn.hidden = standaloneLink.hidden = true;
  };

  const renderList = () => {
    const visible = filteredItems();
    countEl.textContent = String(visible.length);
    listEl.replaceChildren();
    for (const item of visible) {
      const btn = document.createElement("button");
      btn.type = "button"; btn.className = "item";
      btn.setAttribute("role", "option"); btn.setAttribute("aria-selected", String(item.id === selectedId));
      const title = Object.assign(document.createElement("div"), { className: "item-title", textContent: item.title });
      const meta = Object.assign(document.createElement("div"), { className: "item-meta" });
      meta.append(Object.assign(document.createElement("span"), { textContent: item.id }), Object.assign(document.createElement("span"), { textContent: relativeTime(item.updatedAt) }));
      const sub = Object.assign(document.createElement("div"), { className: "item-sub", textContent: item.sessionTitle ? item.sessionTitle + " · " + item.entry : item.entry });
      btn.append(title, meta, sub);
      btn.addEventListener("click", () => selectArtifact(item.id));
      listEl.append(btn);
    }
  };

  const selectArtifact = (id, forceReload = false) => {
    const chosen = filteredItems().find((item) => item.id === id) || allItems.find((item) => item.id === id);
    if (!chosen) {
      selectedId = undefined; syncUrl(undefined); activeTitle.textContent = "No artifact selected";
      showMessage(allItems.length === 0 ? "No artifacts published yet" : "No matching artifacts", allItems.length === 0 ? "Publish a canvas or artifact in OpenCode, then click Refresh." : "Clear the search filter or switch back to All project.");
      renderList(); return;
    }
    const changed = selectedId !== chosen.id;
    selectedId = chosen.id; syncUrl(chosen.id); activeTitle.textContent = chosen.title;
    copyIdBtn.textContent = chosen.id; copyIdBtn.hidden = reloadFrameBtn.hidden = standaloneLink.hidden = false;
    const baseHref = "/" + encodeURIComponent(chosen.id) + "/";
    standaloneLink.href = baseHref; emptyState.hidden = true; viewer.hidden = false;
    if (changed || forceReload || !viewer.getAttribute("src")) viewer.src = baseHref + "?v=" + (++frameNonce);
    renderList();
  };

  const loadArtifacts = async (forceReload = false) => {
    try {
      const data = await (await fetch("/api/artifacts", { cache: "no-store" })).json();
      if (data.status === "disabled") {
        allItems = []; countEl.textContent = "0"; listEl.replaceChildren(); activeTitle.textContent = "Artifacts disabled";
        showMessage("Experimental artifacts are disabled", "Enable experimental.artifacts: true in opencode.json or set OPENCODE_FLAGS=artifacts.");
        return;
      }
      if (data.status !== "ok") { showMessage("Could not load artifacts", data.message || "Unknown server error."); return; }
      allItems = Array.isArray(data.items) ? data.items : [];
      activeSessionID = data.sessionID; scopeRow.hidden = !activeSessionID;
      const visible = filteredItems();
      const target = (selectedId && allItems.some((item) => item.id === selectedId) ? selectedId : undefined) || (visible[0] && visible[0].id);
      selectArtifact(target, forceReload);
    } catch (err) {
      showMessage("Gallery connection lost", err instanceof Error ? err.message : String(err));
    }
  };

  searchInput.addEventListener("input", () => {
    const visible = filteredItems();
    if (selectedId && visible.some((item) => item.id === selectedId)) renderList(); else selectArtifact(visible[0] && visible[0].id);
  });
  for (const pill of scopeRow.querySelectorAll("[data-scope]")) {
    pill.addEventListener("click", () => {
      scope = pill.getAttribute("data-scope") || "all";
      for (const other of scopeRow.querySelectorAll("[data-scope]")) other.setAttribute("aria-pressed", String(other === pill));
      const visible = filteredItems();
      if (!selectedId || !visible.some((item) => item.id === selectedId)) selectArtifact(visible[0] && visible[0].id); else renderList();
    });
  }
  $("refreshBtn").addEventListener("click", () => void loadArtifacts(false));
  reloadFrameBtn.addEventListener("click", () => void loadArtifacts(true));
  $("toggleSidebarBtn").addEventListener("click", () => shell.classList.toggle("collapsed"));
  copyIdBtn.addEventListener("click", () => {
    if (!selectedId || !navigator.clipboard) return;
    void navigator.clipboard.writeText(selectedId).then(() => {
      const saved = copyIdBtn.textContent; copyIdBtn.textContent = "Copied";
      setTimeout(() => { if (copyIdBtn.textContent === "Copied") copyIdBtn.textContent = saved; }, 900);
    });
  });
  document.addEventListener("keydown", (event) => {
    const inInput = document.activeElement === searchInput;
    if (event.key === "/" && !inInput && !event.metaKey && !event.ctrlKey && !event.altKey) { event.preventDefault(); searchInput.focus(); searchInput.select(); return; }
    if (event.key === "Escape" && inInput) { if (searchInput.value) { searchInput.value = ""; searchInput.dispatchEvent(new Event("input")); } else searchInput.blur(); return; }
    if (inInput || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "[") { event.preventDefault(); shell.classList.toggle("collapsed"); return; }
    if (event.key === "r") { event.preventDefault(); void loadArtifacts(true); return; }
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "j" || event.key === "k") {
      const visible = filteredItems(); if (visible.length === 0) return; event.preventDefault();
      const delta = event.key === "ArrowDown" || event.key === "j" ? 1 : -1;
      const cur = visible.findIndex((item) => item.id === selectedId);
      selectArtifact(visible[cur === -1 ? 0 : (cur + delta + visible.length) % visible.length].id);
    }
  });
  void loadArtifacts(false);
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

const serveArtifactRoute = async (
  method: string,
  url: URL,
  directory: string,
  store: ArtifactStore,
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

export const createRequestHandler = (input: {
  readonly store: ArtifactStore;
  readonly getContext: () => { readonly directory: string; readonly sessionID?: string };
  readonly expectedPort?: () => number;
}): ((request: Request) => Promise<Response>) => {
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
    if (url.pathname === "/api/artifacts") {
      if (isCrossSiteFetch(request)) {
        return respond(
          method,
          403,
          "application/json; charset=utf-8",
          JSON.stringify({ status: "error", message: "Cross-site requests are not allowed" }),
        );
      }
      const listed = await input.store.list(active.directory, active.sessionID);
      return respond(method, 200, "application/json; charset=utf-8", JSON.stringify(listed));
    }

    return serveArtifactRoute(method, url, active.directory, input.store);
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
    galleryUrl: (artifactID) =>
      artifactID === undefined
        ? `${origin}/`
        : `${origin}/?select=${encodeURIComponent(artifactID)}`,
    standaloneUrl: (artifactID) => `${origin}/${encodeURIComponent(artifactID)}/`,
    stop: () => {
      void server.stop(true);
    },
  };
};
