import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  canvasDirectory,
  canvasFile,
  deadLinks,
  launcherFor,
  list,
  present,
  save,
  slugProblem,
  treeOf,
  writeEvidence,
} from "../../tools/definitions/canvas/store";

/**
 * Every path here is under the real data root, because the derivation is the
 * thing under test and a test-only root would not exercise it. The tree name is
 * `canvas-test-<pid>`, and nothing reads it in a real session.
 */
const TREE = `canvas-test-${process.pid}`;

const cleanup = async () => {
  const { rm } = await import("node:fs/promises");
  const { canvasesRoot } = await import("../../tools/definitions/canvas/store");
  await rm(canvasesRoot(TREE), { recursive: true, force: true });
};

const write = async (slug: string, body: string) => {
  const directory = canvasDirectory(TREE, slug);
  await save(TREE, slug);
  await Bun.write(canvasFile(directory), body);
  return directory;
};

beforeEach(cleanup);
afterEach(cleanup);

describe("a slug is a directory name a person reads", () => {
  test("lowercase kebab-case is accepted", () => {
    expect(slugProblem("tool-registration")).toBeUndefined();
    expect(slugProblem("pr-42-runtime-sync")).toBeUndefined();
  });

  test("anything else is refused with the rule that refused it", () => {
    expect(slugProblem("")).toBe("slug is empty");
    expect(slugProblem("Tool-Registration")).toContain("lowercase kebab-case");
    expect(slugProblem("tool_registration")).toContain("lowercase kebab-case");
    expect(slugProblem("tool--registration")).toContain("lowercase kebab-case");
    expect(slugProblem("a".repeat(41))).toContain("40 characters");
  });
});

describe("the tree name is derived, not declared", () => {
  test("the project directory's basename is the name", () => {
    expect(treeOf("/Users/yriveiro/Development/github/spectre-worktrees/canvas", undefined)).toBe(
      "canvas",
    );
  });

  test("git's toplevel is the fallback, and only when the basename is empty", () => {
    // `basename("/")` is the empty string, so a checkout at the filesystem root
    // is the one case the cheap answer cannot answer.
    expect(treeOf("/", undefined)).toBeUndefined();
    expect(treeOf("/", "/Users/yriveiro/Development/github/spectre")).toBe("spectre");
    expect(treeOf("/repo/", "/Users/yriveiro/Development/github/spectre")).toBe("repo");
  });

  test("a name that is traversal or a flag is not a name", () => {
    expect(treeOf("/x/..", undefined)).toBeUndefined();
    expect(treeOf("/x/-rf", undefined)).toBeUndefined();
  });
});

describe("save never overwrites", () => {
  test("the first call allocates and the second reports taken with the same path", async () => {
    const first = await save(TREE, "alpha");
    expect(first).toEqual({ status: "saved", directory: canvasDirectory(TREE, "alpha") });

    const second = await save(TREE, "alpha");
    expect(second).toEqual({ status: "taken", directory: canvasDirectory(TREE, "alpha") });
  });

  test("a page written into an allocated directory survives a second save", async () => {
    const directory = await write("beta", "<html><head><title>Beta</title></head></html>");
    await save(TREE, "beta");

    expect(await Bun.file(canvasFile(directory)).text()).toContain("<title>Beta</title>");
  });
});

describe("list inventories what a reader can reopen", () => {
  test("every saved canvas is a row, with its title", async () => {
    await write("alpha", "<html><head><title>Alpha page</title></head></html>");
    await write("beta", "<html><head><title>Beta</title></head></html>");

    expect(await list(TREE)).toEqual([
      { id: "alpha", canvas: canvasFile(canvasDirectory(TREE, "alpha")), title: "Alpha page" },
      { id: "beta", canvas: canvasFile(canvasDirectory(TREE, "beta")), title: "Beta" },
    ]);
  });

  test("a page with no title is a row without one, not a row that fails", async () => {
    await write("gamma", "<html><body>no title here</body></html>");

    expect(await list(TREE)).toEqual([
      { id: "gamma", canvas: canvasFile(canvasDirectory(TREE, "gamma")) },
    ]);
  });

  test("a slug allocated but never written is not listed, because there is nothing to open", async () => {
    await save(TREE, "allocated-only");

    expect(await list(TREE)).toEqual([]);
  });

  test("no tree at all is an empty list, not a throw", async () => {
    expect(await list("canvas-test-never-created")).toEqual([]);
  });
});

describe("presentation goes through the OS launcher and nothing else", () => {
  test("each platform names one launcher", () => {
    expect(launcherFor("darwin")).toBe("open");
    expect(launcherFor("linux")).toBe("xdg-open");
    expect(launcherFor("win32")).toBe("start");
  });

  test("an unknown platform has no launcher, and guessing is a refusal", () => {
    expect(launcherFor("freebsd")).toBeUndefined();
  });

  test("a page that is not there is not-opened, with the path in hand", async () => {
    const canvas = canvasFile(canvasDirectory(TREE, "missing"));
    const opened = await present(canvas, process.platform);

    expect(opened.status).toBe("not-opened");
    if (opened.status !== "not-opened") throw new Error("expected not-opened");
    expect(opened.canvas).toBe(canvas);
    expect(opened.why).toContain("does not exist");
  });

  test("an unknown platform refuses rather than reaching for another launcher", async () => {
    const directory = await write("epsilon", "<html><title>Epsilon</title></html>");
    const opened = await present(canvasFile(directory), "freebsd");

    expect(opened.status).toBe("not-opened");
    if (opened.status !== "not-opened") throw new Error("expected not-opened");
    expect(opened.why).toContain("no launcher is known for freebsd");
  });

  test("a launcher that is not on PATH refuses, and never falls back", async () => {
    // `start` is the win32 launcher and is absent on every non-Windows machine,
    // so this is the missing-launcher path. Which launchers exist is machine
    // state, so the expectation follows the probe rather than assuming it.
    const directory = await write("zeta", "<html><title>Zeta</title></html>");
    const opened = await present(canvasFile(directory), "win32");

    expect(opened.status).toBe(Bun.which("start") === null ? "not-opened" : "opened");
    if (Bun.which("start") !== null) return;
    if (opened.status !== "not-opened") throw new Error("expected not-opened");
    expect(opened.why).toContain("not on PATH");
  });
});

describe("deadLinks is a lexical check that can fail", () => {
  test("an anchor with no id is dead, and a live one is not", () => {
    const html = `<a href="#overview">go</a><h1 id="overview">Overview</h1><a href="#missing">gone</a>`;

    expect(deadLinks(html)).toEqual(["missing"]);
  });

  test("a page with no anchors has none", () => {
    expect(deadLinks("<p>nothing to click</p>")).toEqual([]);
  });

  test("a data-id is not an id, so an anchor naming it is dead", () => {
    expect(deadLinks(`<a href="#x"></a><div data-id="x"></div>`)).toEqual(["x"]);
  });

  test("an empty fragment is not reported, because it is not an anchor", () => {
    expect(deadLinks(`<a href="#"></a>`)).toEqual([]);
  });
});

describe("evidence is written whole, and the result points at it", () => {
  const file = {
    status: "read" as const,
    index: 1,
    path: "tools/index.ts",
    additions: 3,
    deletions: 1,
    rows: [
      { kind: "hunk" as const, header: "@@ -1,1 +1,3 @@" },
      { kind: "context" as const, old: 1, new: 1, text: "line one" },
      { kind: "removed" as const, old: 2, text: "old two" },
      { kind: "added" as const, new: 2, text: "new two" },
      { kind: "added" as const, new: 3, text: "extra" },
    ],
  };

  test("every row is on disk and the manifest carries the cross-check", async () => {
    const directory = canvasDirectory(TREE, "delta");
    await save(TREE, "delta");

    const manifest = {
      subject: { kind: "local-diff" },
      cross: { kind: "no-oracle" },
      problems: [],
    };
    const rows = await writeEvidence(directory, manifest, [file]);

    expect(rows).toEqual([
      {
        status: "read",
        index: 1,
        path: "tools/index.ts",
        additions: 3,
        deletions: 1,
        evidence: `${directory}/evidence/files/0001.json`,
      },
    ]);
    expect(await Bun.file(`${directory}/evidence/index.json`).json()).toEqual(manifest);

    const written = await Bun.file(`${directory}/evidence/files/0001.json`).json();
    expect(written.rows).toHaveLength(5);
    expect(written.additions).toBe(3);
  });

  test("an unreadable file is a row with its reason, and still gets a file", async () => {
    const directory = canvasDirectory(TREE, "epsilon");
    await save(TREE, "epsilon");

    const rows = await writeEvidence(directory, {}, [
      { status: "unreadable", index: 1, path: "logo.png", reason: "binary file, no text rows" },
    ]);

    expect(rows).toEqual([
      {
        status: "unreadable",
        index: 1,
        path: "logo.png",
        reason: "binary file, no text rows",
        evidence: `${directory}/evidence/files/0001.json`,
      },
    ]);
    expect(await Bun.file(`${directory}/evidence/files/0001.json`).exists()).toBe(true);
  });

  test("the tool does not truncate: 1500 rows are all written", async () => {
    const directory = canvasDirectory(TREE, "zeta");
    await save(TREE, "zeta");

    const rows = Array.from({ length: 1500 }, (_, at) => ({
      kind: "added" as const,
      new: at + 1,
      text: `line ${at}`,
    }));
    await writeEvidence(directory, {}, [
      { status: "read", index: 1, path: "big.ts", rows, additions: 1500, deletions: 0 },
    ]);

    const written = await Bun.file(`${directory}/evidence/files/0001.json`).json();
    expect(written.rows).toHaveLength(1500);
    expect(written.rows[1499]).toEqual({ kind: "added", new: 1500, text: "line 1499" });
  });
});
