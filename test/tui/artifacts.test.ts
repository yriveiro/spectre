import { afterEach, describe, expect, test } from "bun:test";
import type {
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
  type GalleryServer,
  makeClientArtifactStore,
  normalizeSubpath,
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

describe("normalizeSubpath", () => {
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
});

describe("startGalleryServer", () => {
  test("serves artifacts, sub-assets, safe markdown, and live context while blocking DNS rebinding, cross-site API reads, and prototype keys", async () => {
    let htmlBody = "<!doctype html><h1>v1</h1><script src='./vendor/d3.min.js'></script>";
    let currentDirectory = "/repo/one";

    const store: ArtifactStore = {
      list: async (directory, sessionID) => ({
        status: "ok",
        directory,
        sessionID,
        items: [ALPHA_SUMMARY],
      }),
      get: async (artifactID): Promise<ArtifactReadResult> => {
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
    expect(await galleryRes.text()).toContain("Spectre Artifacts");

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

    const crossSiteApi = await fetch(`${server.origin}/api/artifacts`, {
      headers: { "sec-fetch-site": "cross-site" },
    });
    expect(crossSiteApi.status).toBe(403);

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
      expect(listed.items.map((item) => [item.id, item.sessionTitle])).toEqual([
        ["art_new", "Metrics audit"],
        ["art_old", undefined],
      ]);
    }

    const fallbackGet = await store.get("art_new", "/stale-worktree");
    expect(fallbackGet.status).toBe("ok");
    expect(seenGetInputs).toEqual([
      { artifactID: "art_new", directory: "/stale-worktree" },
      { artifactID: "art_new", directory: undefined },
    ]);

    const missing = await store.get("art_missing", "/repo");
    expect(missing.status).toBe("not-found");

    disabled = true;
    const off = await store.list("/repo");
    expect(off.status).toBe("disabled");
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
  test("orders current-session items first without setting category so DialogSelect preserves footers", () => {
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

    expect(searchArtifactOptions("perf flame", options).map((opt) => opt.value.id)).toEqual([
      "art_other",
    ]);
    expect(searchArtifactOptions("art_mine", options).map((opt) => opt.value.id)).toEqual([
      "art_mine",
    ]);
  });

  test("handles disabled/empty states, opens gallery and standalone actions deterministically, and stops on dispose", async () => {
    const toasts: Array<ToastOptions> = [];
    const openedUrls: Array<{ readonly url: string; readonly mode: string }> = [];
    let clearedCount = 0;
    let storeMode: "disabled" | "empty" | "ready" = "disabled";
    const item: ArtifactSummary = {
      ...ALPHA_SUMMARY,
      id: "art_1",
      title: "PR Diff Review",
    };
    let nextDialogBehavior: (
      opts: DialogSelectOptions<ArtifactSummary>,
    ) => ArtifactSummary | undefined = (opts) => opts.options[0]?.value;

    const controller = createArtifactsController({
      store: {
        list: async (directory, sessionID) => {
          if (storeMode === "disabled") {
            return { status: "disabled", directory, message: "disabled" };
          }
          return {
            status: "ok",
            directory,
            sessionID,
            items: storeMode === "empty" ? [] : [item],
          };
        },
        get: async () => ({
          status: "ok",
          id: "art_1",
          title: "PR Diff Review",
          entry: "index.html",
          files: { "index.html": "<h1>review</h1>" },
        }),
      },
      dialog: {
        clear: () => {
          clearedCount += 1;
        },
        select: async (opts) => nextDialogBehavior(opts),
      },
      toast: {
        show: (toast) => {
          toasts.push(toast);
        },
      },
      resolveContext: () => ({ directory: "/repo", sessionID: "ses_1" }),
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
      await controller.openModal();
      expect(toasts.at(-1)?.message).toBe("No artifacts published in this project yet");
      expect(openedUrls).toHaveLength(0);

      storeMode = "ready";
      await controller.openModal();
      expect(openedUrls).toHaveLength(1);
      const firstOpened = openedUrls[0];
      if (firstOpened === undefined) throw new Error("expected first opened url");
      expect(firstOpened.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/\?select=art_1$/);

      const liveFetch = await fetch(firstOpened.url.replace("/?select=art_1", "/art_1/"));
      expect(await liveFetch.text()).toBe("<h1>review</h1>");

      nextDialogBehavior = (opts) => {
        expect(opts.current?.id).toBe("art_1");
        const standalone = opts.actions?.find((act) => act.title === "Standalone");
        if (standalone && standalone.selection !== "none") {
          standalone.onTrigger(item);
        }
        return undefined;
      };

      await controller.openModal();
      expect(clearedCount).toBe(1);
      expect(openedUrls).toHaveLength(2);
      expect(openedUrls[1]?.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/art_1\/$/);

      await controller.openGallery();
      expect(openedUrls).toHaveLength(3);
      expect(openedUrls[2]?.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/\?select=art_1$/);
    } finally {
      controller.dispose();
    }

    await controller.openGallery();
    expect(openedUrls).toHaveLength(3);
  });
});
