import { afterEach, describe, expect, test } from "bun:test";
import type {
  DialogPromptOptions,
  DialogSelectOption,
  DialogSelectOptions,
  ToastOptions,
} from "@opencode/plugin/tui/context";
import {
  type ArtifactReadResult,
  type ArtifactStore,
  type ArtifactSummary,
  type CommandResult,
  createArtifactsController,
  createBrowserOpener,
  formatGalleryUrl,
  type GalleryServer,
  makeClientArtifactStore,
  normalizeSubpath,
  parentDirectoryOf,
  resolveDirectoryPath,
  runCommand,
  searchArtifactOptions,
  startGalleryServer,
  systemBrowserCommand,
  toDialogOptions,
} from "../../tui/artifacts/index.ts";
import { opener } from "../../tui/index.tsx";

const activeServers: Array<GalleryServer> = [];

afterEach(() => {
  while (activeServers.length > 0) {
    activeServers.pop()?.stop();
  }
});

const ALPHA_SUMMARY: ArtifactSummary = {
  id: "art_alpha",
  title: "PR #42 Architecture Review",
  entry: "index.html",
  provider: "local",
  sessionID: "ses_1",
  sessionTitle: "Review auth flow",
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_120_000,
};

const BETA_SUMMARY: ArtifactSummary = {
  id: "art_beta",
  title: "Billing Latency Chart",
  entry: "index.html",
  provider: "local",
  sessionID: "ses_billing",
  sessionTitle: "Billing trace",
  createdAt: 1_700_000_200_000,
  updatedAt: 1_700_000_300_000,
  projectDirectory: "/projects/billing",
  projectName: "billing",
};

describe("opener artifact commands", () => {
  test("keeps routing first and exposes /artifact-search and /artifact-gallery in the global layer", () => {
    let routingRuns = 0;
    let modalRuns = 0;
    let galleryRuns = 0;
    const layer = opener(
      () => {
        routingRuns += 1;
      },
      () => {
        modalRuns += 1;
      },
      () => {
        galleryRuns += 1;
      },
    );

    expect(layer.mode).toBe("global");
    expect(
      layer.commands.map((cmd) => ({
        id: cmd.id,
        title: cmd.title,
        palette: cmd.palette,
        slash: cmd.slash,
      })),
    ).toEqual([
      {
        id: "spectre.routing.open",
        title: "Routing",
        palette: true,
        slash: { name: "routing" },
      },
      {
        id: "spectre.artifacts.search",
        title: "Artifact Search",
        palette: true,
        slash: { name: "artifact-search" },
      },
      {
        id: "spectre.artifacts.gallery",
        title: "Artifact Gallery",
        palette: true,
        slash: { name: "artifact-gallery" },
      },
    ]);

    layer.commands[0]?.run();
    layer.commands[1]?.run();
    layer.commands[2]?.run();
    expect({ routingRuns, modalRuns, galleryRuns }).toEqual({
      routingRuns: 1,
      modalRuns: 1,
      galleryRuns: 1,
    });
  });
});

describe("normalizeSubpath and path helpers", () => {
  test("normalizes relative asset paths and rejects traversal or malformed encodings", () => {
    expect(normalizeSubpath("./vendor/d3.min.js")).toBe("vendor/d3.min.js");
    expect(normalizeSubpath("/assets/chart%201.svg")).toBe("assets/chart 1.svg");
    expect(normalizeSubpath("")).toBeUndefined();
    expect(normalizeSubpath("../secret.txt")).toBeUndefined();
    expect(normalizeSubpath("assets/../../secret.txt")).toBeUndefined();
    expect(normalizeSubpath("%2e%2e/secret.txt")).toBeUndefined();
    expect(normalizeSubpath("assets%2f..%2fsecret.txt")).toBeUndefined();
    expect(normalizeSubpath("bad\0path.js")).toBeUndefined();
    expect(normalizeSubpath("%E0%A4%A")).toBeUndefined();
  });

  test("resolves ~, relative segments, root parents, and gallery query URLs", () => {
    expect(resolveDirectoryPath("~", "/work/app", "/Users/dev")).toBe("/Users/dev");
    expect(resolveDirectoryPath("~/code/billing", "/work/app", "/Users/dev")).toBe(
      "/Users/dev/code/billing",
    );
    expect(resolveDirectoryPath("../sibling", "/work/app", "/Users/dev")).toBe("/work/sibling");
    expect(parentDirectoryOf("/work/app")).toBe("/work");
    expect(parentDirectoryOf("/")).toBeUndefined();

    expect(formatGalleryUrl("http://127.0.0.1:9000", "art_1")).toBe(
      "http://127.0.0.1:9000/?select=art_1",
    );
    expect(formatGalleryUrl("http://127.0.0.1:9000", "art_1", { scope: "all" })).toBe(
      "http://127.0.0.1:9000/?scope=all&select=art_1",
    );
    expect(
      formatGalleryUrl("http://127.0.0.1:9000", "art_1", { directory: "/projects/billing" }),
    ).toBe("http://127.0.0.1:9000/?directory=%2Fprojects%2Fbilling&select=art_1");
  });
});

describe("startGalleryServer", () => {
  test("serves artifacts, multi-project & filesystem APIs, sub-assets, safe markdown, and live context while blocking DNS rebinding and cross-site API reads", async () => {
    let htmlBody = "<!doctype html><h1>v1</h1><script src='./vendor/d3.min.js'></script>";
    let currentDirectory = "/repo/one";
    const seenGets: Array<{ readonly id: string; readonly directory: string | undefined }> = [];

    const store: ArtifactStore = {
      list: async (directory, sessionID) => ({
        status: "ok",
        directory,
        sessionID,
        items: directory === "/projects/billing" ? [BETA_SUMMARY] : [ALPHA_SUMMARY],
      }),
      listAll: async (activeDirectory, activeSessionID) => ({
        status: "ok",
        scope: "all",
        directory: activeDirectory,
        activeDirectory,
        projectName: "All projects",
        sessionID: activeSessionID,
        items: [BETA_SUMMARY, ALPHA_SUMMARY],
      }),
      listProjects: async (activeDirectory) => [
        {
          id: "proj_current",
          name: "one",
          directory: activeDirectory,
          kind: "project",
          isCurrent: true,
        },
        {
          id: "proj_billing",
          name: "billing",
          directory: "/projects/billing",
          kind: "project",
          isCurrent: false,
        },
      ],
      listDirectories: async (targetPath) => ({
        status: "ok",
        directory: targetPath,
        parent: parentDirectoryOf(targetPath),
        home: "/Users/dev",
        entries: [{ name: "billing", directory: "/projects/billing" }],
      }),
      get: async (artifactID, directory): Promise<ArtifactReadResult> => {
        seenGets.push({ id: artifactID, directory });
        if (artifactID === "art_alpha") {
          return {
            status: "ok",
            id: "art_alpha",
            title: "Chart",
            entry: "index.html",
            files: {
              "index.html": htmlBody,
              "vendor/d3.min.js": "window.D3_READY = true;",
            },
          };
        }
        if (artifactID === "art_beta") {
          return {
            status: "ok",
            id: "art_beta",
            title: "Billing",
            entry: "index.html",
            files: { "index.html": "<p>billing</p>" },
          };
        }
        if (artifactID === "art_notes") {
          return {
            status: "ok",
            id: "art_notes",
            title: "Release Notes",
            entry: "index.md",
            files: {
              "index.md": "# Shipped\n\n<script>window.pwn=1</script>\n\nAll checks green.",
            },
          };
        }
        return { status: "not-found", message: `Missing ${artifactID}` };
      },
    };

    const server = startGalleryServer({
      store,
      getContext: () => ({ directory: currentDirectory, sessionID: "ses_1" }),
    });
    activeServers.push(server);

    const rebindRes = await fetch(`${server.origin}/api/artifacts`, {
      headers: { host: `evil.rebind.test:${server.port}`, "sec-fetch-site": "same-origin" },
    });
    expect(rebindRes.status).toBe(403);

    const galleryRes = await fetch(server.galleryUrl("art_alpha"));
    expect(galleryRes.status).toBe(200);
    const galleryHtml = await galleryRes.text();
    expect(galleryHtml).toContain("Spectre Artifacts");
    expect(galleryHtml).toContain("All projects");
    expect(galleryHtml).toContain("Filesystem");

    const redirectRes = await fetch(`${server.origin}/art_alpha`, { redirect: "manual" });
    expect(redirectRes.status).toBe(308);
    expect(redirectRes.headers.get("location")).toBe("/art_alpha/");

    const encodedRedirect = await fetch(`${server.origin}/art_%61lpha/vendor/d3.min.js`, {
      redirect: "manual",
    });
    expect(encodedRedirect.status).toBe(308);
    expect(encodedRedirect.headers.get("location")).toBe("/art_alpha/vendor/d3.min.js");

    const protoRes = await fetch(`${server.origin}/art_alpha/toString`);
    expect(protoRes.status).toBe(404);

    const entryRes = await fetch(server.standaloneUrl("art_alpha"));
    expect(entryRes.status).toBe(200);
    expect(entryRes.headers.get("content-security-policy")).toBe("sandbox allow-scripts");
    expect(await entryRes.text()).toBe(htmlBody);

    const subAssetRes = await fetch(`${server.origin}/art_alpha/vendor/d3.min.js`, {
      headers: { "sec-fetch-site": "cross-site", "sec-fetch-mode": "no-cors" },
    });
    expect(subAssetRes.status).toBe(200);
    expect(subAssetRes.headers.get("content-type")).toContain("javascript");
    expect(await subAssetRes.text()).toBe("window.D3_READY = true;");

    htmlBody = "<!doctype html><h1>v2</h1>";
    const updatedRes = await fetch(server.standaloneUrl("art_alpha"));
    expect(await updatedRes.text()).toBe("<!doctype html><h1>v2</h1>");

    const mdRendered = await fetch(server.standaloneUrl("art_notes"));
    expect(mdRendered.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(mdRendered.headers.get("content-security-policy")).toBe(
      "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:",
    );
    const mdHtml = await mdRendered.text();
    expect(mdHtml).toContain("<h1>Shipped</h1>");
    expect(mdHtml).not.toContain("<script>");

    const mdRaw = await fetch(`${server.standaloneUrl("art_notes")}?raw=1`);
    expect(mdRaw.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(await mdRaw.text()).toContain("# Shipped");

    currentDirectory = "/repo/two";
    const sameOriginApi = await fetch(`${server.origin}/api/artifacts`, {
      headers: { "sec-fetch-site": "same-origin" },
    });
    expect(sameOriginApi.status).toBe(200);
    expect(await sameOriginApi.json()).toEqual({
      status: "ok",
      directory: "/repo/two",
      sessionID: "ses_1",
      items: [ALPHA_SUMMARY],
    });

    const allScopeApi = await fetch(`${server.origin}/api/artifacts?scope=all`, {
      headers: { "sec-fetch-site": "same-origin" },
    });
    expect(allScopeApi.status).toBe(200);
    expect(await allScopeApi.json()).toEqual({
      status: "ok",
      scope: "all",
      directory: "/repo/two",
      activeDirectory: "/repo/two",
      projectName: "All projects",
      sessionID: "ses_1",
      items: [BETA_SUMMARY, ALPHA_SUMMARY],
    });

    const dirScopeApi = await fetch(
      `${server.origin}/api/artifacts?directory=%2Fprojects%2Fbilling`,
      { headers: { "sec-fetch-site": "same-origin" } },
    );
    expect(dirScopeApi.status).toBe(200);
    expect(await dirScopeApi.json()).toEqual({
      status: "ok",
      scope: "directory",
      directory: "/projects/billing",
      activeDirectory: "/repo/two",
      projectName: "billing",
      sessionID: undefined,
      items: [BETA_SUMMARY],
    });

    const projectsApi = await fetch(`${server.origin}/api/projects`, {
      headers: { "sec-fetch-site": "same-origin" },
    });
    expect(projectsApi.status).toBe(200);
    const projectsPayload = (await projectsApi.json()) as {
      readonly status: string;
      readonly projects: ReadonlyArray<{ readonly name: string }>;
    };
    expect(projectsPayload.status).toBe("ok");
    expect(projectsPayload.projects).toHaveLength(2);

    const fsApi = await fetch(`${server.origin}/api/fs?path=%2Fprojects`, {
      headers: { "sec-fetch-site": "same-origin" },
    });
    expect(fsApi.status).toBe(200);
    expect(await fsApi.json()).toEqual({
      status: "ok",
      directory: "/projects",
      parent: "/",
      home: "/Users/dev",
      entries: [{ name: "billing", directory: "/projects/billing" }],
    });

    const crossProjectView = await fetch(
      `${server.origin}/art_beta/?directory=%2Fprojects%2Fbilling`,
    );
    expect(await crossProjectView.text()).toBe("<p>billing</p>");
    expect(seenGets.at(-1)).toEqual({ id: "art_beta", directory: "/projects/billing" });

    for (const protectedPath of ["/api/artifacts", "/api/projects", "/api/fs?path=/projects"]) {
      const blocked = await fetch(`${server.origin}${protectedPath}`, {
        headers: { "sec-fetch-site": "cross-site" },
      });
      expect(blocked.status).toBe(403);
    }

    const traversal = await fetch(`${server.origin}/art_alpha/assets%2f..%2fsecret`);
    expect(traversal.status).toBe(400);
  });
});

describe("makeClientArtifactStore", () => {
  test("sorts newest updated first, forwards location to get with worktree fallback, and classifies ForbiddenError", async () => {
    let disabled = false;
    const seenGetInputs: Array<{ readonly artifactID: string; readonly directory?: string }> = [];

    const store = makeClientArtifactStore({
      sessionTitle: (id) => (id === "ses_2" ? "Metrics audit" : undefined),
      client: {
        experimental: {
          artifacts: {
            list: async () => {
              if (disabled) {
                throw Object.assign(new Error("Artifacts are disabled"), {
                  _tag: "ForbiddenError",
                });
              }
              return {
                location: { directory: "/repo" },
                data: [
                  {
                    id: "art_old" as never,
                    provider: "local",
                    title: "Older",
                    entry: "index.html",
                    url: "/api/experimental/artifacts/art_old/view/",
                    time: { created: 10, updated: 20 },
                  },
                  {
                    id: "art_new" as never,
                    provider: "local",
                    sessionID: "ses_2" as never,
                    title: "Newer",
                    entry: "index.html",
                    url: "/api/experimental/artifacts/art_new/view/",
                    time: { created: 15, updated: 50 },
                  },
                ],
              };
            },
            get: async (input: {
              readonly artifactID: string;
              readonly location?: { readonly directory?: string };
            }) => {
              seenGetInputs.push({
                artifactID: input.artifactID,
                directory: input.location?.directory,
              });
              if (input.artifactID === "art_missing") {
                throw Object.assign(new Error("Missing"), { _tag: "ArtifactNotFoundError" });
              }
              if (input.location?.directory === "/stale-worktree") {
                throw Object.assign(new Error("Gone"), { _tag: "LocationNotFoundError" });
              }
              return {
                location: { directory: "/repo" },
                data: {
                  info: {
                    id: "art_new" as never,
                    provider: "local",
                    title: "Newer",
                    entry: "index.html",
                    url: "/api/experimental/artifacts/art_new/view/",
                    time: { created: 15, updated: 50 },
                  },
                  files: { "index.html": "<p>ok</p>" },
                },
              };
            },
          },
        } as never,
      },
    });

    const listed = await store.list("/repo", "ses_1");
    expect(listed.status).toBe("ok");
    if (listed.status === "ok") {
      expect(listed.items.map((item) => [item.id, item.sessionTitle, item.projectName])).toEqual([
        ["art_new", "Metrics audit", "repo"],
        ["art_old", undefined, "repo"],
      ]);
    }

    const fallbackGet = await store.get("art_missing_cached", "/stale-worktree");
    expect(fallbackGet.status).toBe("ok");
    expect(seenGetInputs).toEqual([
      { artifactID: "art_missing_cached", directory: "/stale-worktree" },
      { artifactID: "art_missing_cached", directory: undefined },
    ]);

    const cachedOwnerGet = await store.get("art_new", "/stale-worktree");
    expect(cachedOwnerGet.status).toBe("ok");
    expect(seenGetInputs.at(-1)).toEqual({ artifactID: "art_new", directory: "/repo" });

    const missing = await store.get("art_missing", "/repo");
    expect(missing.status).toBe("not-found");

    disabled = true;
    const off = await store.list("/repo");
    expect(off.status).toBe("disabled");
  });

  test("aggregates canvases across all projects, falls back to surviving worktrees on missing canonical dirs, and browses filesystem directories", async () => {
    const seenGets: Array<{ readonly artifactID: string; readonly directory?: string }> = [];

    const store = makeClientArtifactStore({
      homeDirectory: "/Users/dev",
      projects: () => [
        {
          id: "proj_main",
          canonical: "/Users/dev/spectre/main",
          name: "spectre",
          vcs: "git",
          activeAt: 100,
        },
      ],
      sessions: () => [
        {
          id: "ses_scratch",
          directory: "/Users/dev/scratch-ui",
          title: "Scratch UI",
        },
      ],
      client: {
        project: {
          list: async () =>
            [
              {
                id: "proj_main",
                canonical: "/Users/dev/spectre/main",
                name: "spectre",
                vcs: "git",
                time: { created: 1, updated: 2, active: 200 },
                sandboxes: [],
              },
              {
                id: "proj_moved",
                canonical: "/Users/dev/deleted-canonical",
                name: "payments",
                vcs: "git",
                time: { created: 1, updated: 2, active: 150 },
                sandboxes: [],
              },
              {
                id: "proj_off",
                canonical: "/Users/dev/disabled-repo",
                name: "legacy",
                time: { created: 1, updated: 2, active: 50 },
                sandboxes: [],
              },
            ] as never,
        } as never,
        worktree: {
          list: async (input: { readonly projectID: string }) => {
            if (input.projectID === "proj_main") {
              return [
                { directory: "/Users/dev/spectre/main" },
                { directory: "/Users/dev/spectre/wt-feature", strategy: "git" },
              ] as never;
            }
            if (input.projectID === "proj_moved") {
              return [{ directory: "/Users/dev/payments-worktree", strategy: "git" }] as never;
            }
            return [] as never;
          },
        } as never,
        file: {
          list: async (input?: {
            readonly location?: { readonly directory?: string };
            readonly path?: string;
          }) => {
            if (input?.location?.directory === "/Users/dev/missing-anchor") {
              throw Object.assign(new Error("Missing anchor"), { _tag: "LocationNotFoundError" });
            }
            return {
              location: { directory: "/Users/dev/spectre/wt-feature" as never },
              data: [
                { path: "../../payments-worktree" as never, type: "directory" as const },
                { path: "../../.config" as never, type: "directory" as const },
                { path: "../../notes.txt" as never, type: "file" as const },
                { path: "../../alpha-service" as never, type: "directory" as const },
              ],
            };
          },
        } as never,
        experimental: {
          artifacts: {
            list: async (input?: { readonly location?: { readonly directory?: string } }) => {
              const dir = input?.location?.directory;
              if (dir === "/Users/dev/deleted-canonical") {
                throw Object.assign(new Error("Canonical missing"), {
                  _tag: "LocationNotFoundError",
                });
              }
              if (dir === "/Users/dev/disabled-repo") {
                throw Object.assign(new Error("Disabled in legacy"), { _tag: "ForbiddenError" });
              }
              if (dir === "/Users/dev/spectre/main" || dir === "/Users/dev/spectre/wt-feature") {
                return {
                  location: { directory: dir as never },
                  data: [
                    {
                      id: "art_spectre" as never,
                      provider: "local",
                      title: "Spectre Brain",
                      entry: "index.html",
                      url: "/api/experimental/artifacts/art_spectre/view/",
                      time: { created: 10, updated: 100 },
                    },
                  ],
                };
              }
              if (dir === "/Users/dev/payments-worktree") {
                return {
                  location: { directory: "/Users/dev/payments-worktree" as never },
                  data: [
                    {
                      id: "art_pay" as never,
                      provider: "local",
                      title: "Payments Flow",
                      entry: "index.html",
                      url: "/api/experimental/artifacts/art_pay/view/",
                      time: { created: 20, updated: 300 },
                    },
                  ],
                };
              }
              if (dir === "/Users/dev/scratch-ui") {
                return {
                  location: { directory: "/Users/dev/scratch-ui" as never },
                  data: [
                    {
                      id: "art_scratch" as never,
                      provider: "local",
                      title: "Scratch Mock",
                      entry: "index.html",
                      url: "/api/experimental/artifacts/art_scratch/view/",
                      time: { created: 30, updated: 200 },
                    },
                  ],
                };
              }
              return { location: { directory: (dir ?? "/") as never }, data: [] };
            },
            get: async (input: {
              readonly artifactID: string;
              readonly location?: { readonly directory?: string };
            }) => {
              seenGets.push({
                artifactID: input.artifactID,
                directory: input.location?.directory,
              });
              return {
                location: { directory: (input.location?.directory ?? "/") as never },
                data: {
                  info: {
                    id: input.artifactID as never,
                    provider: "local",
                    title: "Pay",
                    entry: "index.html",
                    url: `/api/experimental/artifacts/${input.artifactID}/view/`,
                    time: { created: 20, updated: 300 },
                  },
                  files: { "index.html": "<p>pay</p>" },
                },
              };
            },
          },
        } as never,
      },
    });

    const projects = await store.listProjects?.("/Users/dev/spectre/wt-feature");
    expect(projects?.map((proj) => [proj.name, proj.kind, proj.isCurrent])).toEqual([
      ["spectre · wt-feature", "worktree", true],
      ["spectre", "project", false],
      ["payments", "project", false],
      ["payments · payments-worktree", "worktree", false],
      ["legacy", "project", false],
      ["scratch-ui", "session", false],
    ]);

    const all = await store.listAll?.("/Users/dev/spectre/wt-feature", "ses_active");
    expect(all?.status).toBe("ok");
    if (all?.status === "ok") {
      expect(all.items.map((item) => [item.id, item.projectName, item.projectDirectory])).toEqual([
        ["art_pay", "payments", "/Users/dev/payments-worktree"],
        ["art_scratch", "scratch-ui", "/Users/dev/scratch-ui"],
        ["art_spectre", "spectre", "/Users/dev/spectre/wt-feature"],
      ]);
    }

    const gotPay = await store.get("art_pay", "/Users/dev/spectre/wt-feature");
    expect(gotPay.status).toBe("ok");
    expect(seenGets).toEqual([
      { artifactID: "art_pay", directory: "/Users/dev/payments-worktree" },
    ]);

    const fsListing = await store.listDirectories?.("~", "/Users/dev/missing-anchor");
    expect(fsListing).toEqual({
      status: "ok",
      directory: "/Users/dev",
      parent: "/Users",
      home: "/Users/dev",
      entries: [
        { name: "alpha-service", directory: "/Users/dev/alpha-service" },
        { name: "payments-worktree", directory: "/Users/dev/payments-worktree" },
        { name: ".config", directory: "/Users/dev/.config" },
      ],
    });
  });
});

describe("createBrowserOpener", () => {
  test("executes subprocesses, times out background children holding stdio pipes, and reports missing binaries", async () => {
    const ok = await runCommand(["echo", "ready"]);
    expect(ok).toEqual({ ran: true, code: 0, stdout: "ready", stderr: "" });

    const hung = await runCommand(["sh", "-c", "sleep 5"], { timeoutMs: 40 });
    expect(hung.ran).toBe(true);
    if (hung.ran) expect(hung.code).toBe(124);

    const missing = await runCommand(["spectre-nonexistent-binary-xyz"]);
    expect(missing.ran).toBe(false);
  });

  test("serializes concurrent opens, reuses the Spectre tab, recovers closed tabs, and refuses non-http URLs", async () => {
    const calls: Array<ReadonlyArray<string>> = [];
    let failReuseOnce = false;
    let createdTabs = 0;

    const opener = createBrowserOpener({
      platform: "darwin",
      which: () => "/usr/local/bin/browse",
      run: async (argv): Promise<CommandResult> => {
        calls.push(argv);
        if (argv[1] === "status") {
          await Bun.sleep(10);
          return { ran: true, code: 0, stdout: JSON.stringify({ connected: true }), stderr: "" };
        }
        const payload = JSON.parse(argv[3] ?? "{}") as { tab?: number };
        if (payload.tab !== undefined && failReuseOnce) {
          failReuseOnce = false;
          return { ran: true, code: 1, stdout: "", stderr: "Tab 42 no longer exists" };
        }
        if (payload.tab === undefined) {
          createdTabs += 1;
          return {
            ran: true,
            code: 0,
            stdout: JSON.stringify({ tab: createdTabs === 1 ? 42 : 99 }),
            stderr: "",
          };
        }
        return {
          ran: true,
          code: 0,
          stdout: JSON.stringify({ tab: payload.tab }),
          stderr: "",
        };
      },
    });

    const [first, second] = await Promise.all([
      opener.open("http://127.0.0.1:51234/?select=art_1"),
      opener.open("http://127.0.0.1:51234/?select=art_2"),
    ]);
    expect(first).toEqual({ status: "opened", via: "browse", tab: "42" });
    expect(second).toEqual({ status: "opened", via: "browse", tab: "42" });
    expect(createdTabs).toBe(1);
    expect(JSON.parse(calls[1]?.[3] ?? "{}")).toEqual({
      url: "http://127.0.0.1:51234/?select=art_1",
      group: "Spectre",
      keepVisible: true,
      allowedOrigins: ["http://127.0.0.1:51234"],
    });
    expect(JSON.parse(calls[3]?.[3] ?? "{}")).toEqual({
      url: "http://127.0.0.1:51234/?select=art_2",
      tab: 42,
    });

    failReuseOnce = true;
    const recovered = await opener.open("http://127.0.0.1:51234/?select=art_3");
    expect(recovered).toEqual({ status: "opened", via: "browse", tab: "99" });

    const nonHttp = await opener.open("file:///etc/passwd");
    expect(nonHttp).toEqual({
      status: "failed",
      problem: "Only http and https URLs are allowed: file:///etc/passwd",
    });
  });

  test("falls back to the OS browser when browse is offline and uses rundll32 on Windows", async () => {
    const calls: Array<{ readonly argv: ReadonlyArray<string>; readonly ignoreOutput?: boolean }> =
      [];
    const opener = createBrowserOpener({
      platform: "darwin",
      which: () => "/usr/local/bin/browse",
      run: async (argv, opts): Promise<CommandResult> => {
        calls.push({ argv, ignoreOutput: opts?.ignoreOutput });
        if (argv[0] === "browse") {
          return { ran: true, code: 0, stdout: JSON.stringify({ connected: false }), stderr: "" };
        }
        return { ran: true, code: 0, stdout: "", stderr: "" };
      },
    });

    const offlineResult = await opener.open("http://127.0.0.1:51234/");
    expect(offlineResult).toEqual({
      status: "opened",
      via: "system",
      fallbackReason: "browse extension offline",
    });
    expect(calls[1]).toEqual({
      argv: ["open", "http://127.0.0.1:51234/"],
      ignoreOutput: true,
    });

    const explicitSystem = await opener.open("http://127.0.0.1:51234/art_1/", "system");
    expect(explicitSystem).toEqual({
      status: "opened",
      via: "system",
      fallbackReason: undefined,
    });
    expect(systemBrowserCommand("win32", "http://127.0.0.1:9000/?a=1&b=2")).toEqual([
      "rundll32",
      "url.dll,FileProtocolHandler",
      "http://127.0.0.1:9000/?a=1&b=2",
    ]);
    expect(systemBrowserCommand("linux", "http://127.0.0.1:9000/")).toEqual([
      "xdg-open",
      "http://127.0.0.1:9000/",
    ]);
  });
});

describe("dialog options, search, and controller", () => {
  test("orders current-session items first, preserves footers, and shows/searches project badges in all-projects mode", () => {
    const now = 1_700_000_180_000;
    const otherArtifact: ArtifactSummary = {
      id: "art_other",
      title: "LatencyFlamegraph",
      entry: "index.html",
      provider: "s3",
      sessionID: "ses_other",
      sessionTitle: "Perf investigation",
      createdAt: now - 60_000,
      updatedAt: now - 30_000,
      projectDirectory: "/projects/billing",
      projectName: "billing",
    };
    const mineArtifact: ArtifactSummary = {
      id: "art_mine",
      title: "Auth Architecture",
      entry: "index.html",
      provider: "local",
      sessionID: "ses_active",
      sessionTitle: "Current work",
      createdAt: now - 180_000,
      updatedAt: now - 120_000,
      projectDirectory: "/projects/spectre",
      projectName: "spectre",
    };
    const options = toDialogOptions([otherArtifact, mineArtifact], "ses_active", now);

    expect(
      options.map((opt: DialogSelectOption<ArtifactSummary>) => [
        opt.value.id,
        opt.category,
        opt.description,
        opt.footer,
      ]),
    ).toEqual([
      ["art_mine", undefined, "art_mine · index.html", "current · 2m ago"],
      ["art_other", undefined, "art_other · Perf investigation · index.html", "s3 · just now"],
    ]);

    const allOptions = toDialogOptions([otherArtifact, mineArtifact], "ses_active", now, {
      showProject: true,
    });
    expect(allOptions.map((opt) => [opt.value.id, opt.footer])).toEqual([
      ["art_mine", "spectre · current · 2m ago"],
      ["art_other", "s3 · billing · just now"],
    ]);

    expect(searchArtifactOptions("perf flame", options).map((opt) => opt.value.id)).toEqual([
      "art_other",
    ]);
    expect(searchArtifactOptions("billing", allOptions).map((opt) => opt.value.id)).toEqual([
      "art_other",
    ]);
    expect(searchArtifactOptions("art_mine", options).map((opt) => opt.value.id)).toEqual([
      "art_mine",
    ]);
  });

  test("defaults to current project, switches to all projects from an empty project, browses the filesystem, and stops on dispose", async () => {
    const toasts: Array<ToastOptions> = [];
    const openedUrls: Array<{ readonly url: string; readonly mode: string }> = [];
    let clearedCount = 0;
    let storeMode: "disabled" | "empty" | "ready" = "disabled";
    const item: ArtifactSummary = {
      ...ALPHA_SUMMARY,
      id: "art_1",
      title: "PR Diff Review",
      projectDirectory: "/work/repo",
      projectName: "repo",
    };
    const fsItem: ArtifactSummary = {
      ...BETA_SUMMARY,
      id: "art_fs",
      title: "Design Canvas",
      projectDirectory: "/work/design-system",
      projectName: "design-system",
    };

    const selectHandlers: Array<(opts: DialogSelectOptions<unknown>) => unknown> = [];
    let promptHandler: ((opts: DialogPromptOptions) => string | undefined) | undefined;

    const controller = createArtifactsController({
      store: {
        list: async (directory, sessionID) => {
          if (storeMode === "disabled") {
            return { status: "disabled", directory, message: "disabled" };
          }
          if (directory === "/work/design-system") {
            return { status: "ok", directory, sessionID, items: [fsItem] };
          }
          return {
            status: "ok",
            directory,
            sessionID,
            items: storeMode === "empty" ? [] : [item],
          };
        },
        listAll: async (activeDirectory, activeSessionID) => ({
          status: "ok",
          scope: "all",
          directory: activeDirectory,
          activeDirectory,
          projectName: "All projects",
          sessionID: activeSessionID,
          items: [BETA_SUMMARY, ...(storeMode === "empty" ? [] : [item])],
        }),
        listProjects: async (activeDirectory) => [
          {
            id: "proj_repo",
            name: "repo",
            directory: activeDirectory,
            kind: "project",
            isCurrent: true,
          },
          {
            id: "proj_billing",
            name: "billing",
            directory: "/projects/billing",
            kind: "project",
            isCurrent: false,
          },
        ],
        listDirectories: async (targetPath) => {
          if (targetPath === "/work/repo") {
            return {
              status: "ok",
              directory: "/work/repo",
              parent: "/work",
              home: "/Users/dev",
              entries: [],
            };
          }
          return {
            status: "ok",
            directory: "/work",
            parent: "/",
            home: "/Users/dev",
            entries: [
              { name: "design-system", directory: "/work/design-system" },
              { name: "repo", directory: "/work/repo" },
            ],
          };
        },
        get: async (artifactID) => ({
          status: "ok",
          id: artifactID,
          title: "PR Diff Review",
          entry: "index.html",
          files: { "index.html": `<h1>${artifactID}</h1>` },
        }),
      },
      dialog: {
        clear: () => {
          clearedCount += 1;
        },
        select: async <Value>(opts: DialogSelectOptions<Value>): Promise<Value | undefined> => {
          const next = selectHandlers.shift();
          if (next === undefined) return opts.options[0]?.value;
          return next(opts as DialogSelectOptions<unknown>) as Value | undefined;
        },
        prompt: async (opts) => promptHandler?.(opts),
      },
      toast: {
        show: (toast) => {
          toasts.push(toast);
        },
      },
      resolveContext: () => ({ directory: "/work/repo", sessionID: "ses_1" }),
      opener: {
        open: async (url, mode = "auto") => {
          openedUrls.push({ url, mode });
          return { status: "opened", via: "browse", tab: "7" };
        },
      },
    });

    try {
      await controller.openModal();
      expect(toasts.at(-1)?.variant).toBe("warning");
      expect(openedUrls).toHaveLength(0);

      storeMode = "empty";
      selectHandlers.push(
        (opts) => {
          expect(opts.title).toBe("Artifacts · repo");
          expect(opts.options).toHaveLength(0);
          expect(opts.placeholder).toContain("ctrl+a all projects");
          const toggleAll = opts.actions?.find((act) => act.bind === "ctrl+a");
          if (toggleAll?.selection === "none") toggleAll.onTrigger();
          return undefined;
        },
        (opts) => {
          expect(opts.title).toBe("Artifacts · All projects");
          expect(opts.options).toHaveLength(1);
          return opts.options[0]?.value;
        },
      );
      await controller.openModal();
      expect(openedUrls).toHaveLength(1);
      expect(openedUrls[0]?.url).toMatch(
        /^http:\/\/127\.0\.0\.1:\d+\/\?scope=all&select=art_beta$/,
      );

      storeMode = "ready";
      await controller.openModal();
      expect(openedUrls).toHaveLength(2);
      const defaultOpened = openedUrls[1];
      if (defaultOpened === undefined) throw new Error("expected default opened url");
      expect(defaultOpened.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/\?select=art_1$/);

      const liveFetch = await fetch(defaultOpened.url.replace("/?select=art_1", "/art_1/"));
      expect(await liveFetch.text()).toBe("<h1>art_1</h1>");

      selectHandlers.push(
        (opts) => {
          const switchProj = opts.actions?.find((act) => act.bind === "ctrl+f");
          if (switchProj?.selection === "none") switchProj.onTrigger();
          return undefined;
        },
        (opts) => {
          expect(opts.title).toBe("Select project or directory");
          const directTyped = opts.search?.("/custom/path", opts.options);
          expect(directTyped?.at(-1)?.title).toBe("Open path: /custom/path");
          const browseOpt = opts.options.find((opt) => opt.title === "Browse filesystem…");
          return browseOpt?.value;
        },
        (opts) => {
          expect(opts.title).toBe("Browse · /work/repo");
          const upOpt = opts.options.find((opt) => opt.title === "..");
          return upOpt?.value;
        },
        (opts) => {
          expect(opts.title).toBe("Browse · /work");
          const designOpt = opts.options.find((opt) => opt.title === "design-system/");
          const openFolder = opts.actions?.find((act) => act.bind === "ctrl+o");
          if (openFolder && openFolder.selection !== "none" && designOpt !== undefined) {
            openFolder.onTrigger(designOpt.value);
          }
          return undefined;
        },
        (opts) => {
          expect(opts.title).toBe("Artifacts · design-system");
          return opts.options[0]?.value;
        },
      );

      await controller.openModal();
      expect(openedUrls).toHaveLength(3);
      expect(openedUrls[2]?.url).toMatch(
        /^http:\/\/127\.0\.0\.1:\d+\/\?directory=%2Fwork%2Fdesign-system&select=art_fs$/,
      );

      selectHandlers.push((opts) => {
        expect(opts.current).toBeUndefined();
        const standalone = opts.actions?.find((act) => act.title === "Standalone");
        if (standalone && standalone.selection !== "none") {
          standalone.onTrigger(item);
        }
        return undefined;
      });

      const prevClears = clearedCount;
      await controller.openModal();
      expect(clearedCount).toBe(prevClears + 1);
      expect(openedUrls).toHaveLength(4);
      expect(openedUrls[3]?.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/art_1\/$/);

      promptHandler = () => "/work/design-system";
      selectHandlers.push(
        (opts) => {
          const switchProj = opts.actions?.find((act) => act.bind === "ctrl+f");
          if (switchProj?.selection === "none") switchProj.onTrigger();
          return undefined;
        },
        (opts) => opts.options.find((opt) => opt.title === "Enter path…")?.value,
        (opts) => {
          expect(opts.title).toBe("Artifacts · design-system");
          return undefined;
        },
      );
      await controller.openModal();

      await controller.openGallery();
      expect(openedUrls).toHaveLength(5);
      expect(openedUrls[4]?.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/\?select=art_1$/);
    } finally {
      controller.dispose();
    }

    await controller.openGallery();
    expect(openedUrls).toHaveLength(5);
  });
});
