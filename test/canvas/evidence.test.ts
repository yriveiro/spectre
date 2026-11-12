import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, utimes } from "node:fs/promises";
import { join } from "node:path";
import { CACHE_ROOT, load, write } from "../../tools/definitions/canvas/evidence";
import type { ParsedFile } from "../../tools/definitions/canvas/parse";
import type { CrossCheck, Read } from "../../tools/definitions/canvas/read";

const TMP = Bun.env.TMPDIR ?? "/tmp";

const mkProject = (name: string) => join(TMP, `evproj-${name}-${process.pid}-${Date.now()}`);

const digestOf = (p: string) => Bun.hash(p).toString(16).slice(0, 8);

const makeRead = (kind: "pr" | "local"): Extract<Read, { status: "read" }> => {
  const subject =
    kind === "pr"
      ? {
          kind: "pull-request" as const,
          number: 42,
          repository: "yriveiro/spectre",
          url: "https://github.com/yriveiro/spectre/pull/42",
          title: "Canvas artifacts",
          author: "yriveiro",
          state: "open" as const,
          headSha: "c002efd4abc",
          baseRef: "main",
          headRef: "canvas-artifacts",
          additions: 1,
          deletions: 0,
          changedFiles: 1,
          isDraft: false,
          body: "",
        }
      : {
          kind: "local-diff" as const,
          base: "main",
          head: "feature",
          headSha: "c002efd4abc",
        };
  const files: ReadonlyArray<ParsedFile> = [
    { status: "read", index: 1, path: "tools/x.ts", rows: [], additions: 1, deletions: 0 },
  ];
  const cross: CrossCheck =
    kind === "pr"
      ? {
          kind: "matched",
          parsed: { files: 1, additions: 1, deletions: 0 },
          reported: { files: 1, additions: 1, deletions: 0 },
        }
      : { kind: "no-oracle", parsed: { files: 1, additions: 1, deletions: 0 }, why: "no oracle" };
  return {
    status: "read",
    subject,
    files,
    cross,
    problems: [],
  };
};

describe("evidence", () => {
  let projectA: string;
  let projectB: string;

  beforeEach(async () => {
    projectA = mkProject("a");
    projectB = mkProject("b");
    await mkdir(projectA, { recursive: true });
    await mkdir(projectB, { recursive: true });
  });

  afterAll(async () => {
    // best effort cleanup of cache dirs
    for (const p of [projectA, projectB]) {
      try {
        await rm(join(CACHE_ROOT, digestOf(p)), { recursive: true, force: true });
      } catch {}
    }
  });

  test("same Read twice yields same token; changed row yields different; local starts local-", async () => {
    const r1 = makeRead("pr");
    const e1 = await write(projectA, r1);
    const e2 = await write(projectA, r1);
    expect(e2.token).toBe(e1.token);

    const base = makeRead("pr");
    const first = base.files[0];
    if (first === undefined) throw new Error("expected a file");
    const changed = first.status === "read" ? { ...first, additions: 999 } : first;
    const r2 = { ...base, files: [changed, ...base.files.slice(1)] };
    const e3 = await write(projectA, r2);
    expect(e3.token).not.toBe(e1.token);

    const el = await write(projectA, makeRead("local"));
    expect(el.token.startsWith("local-")).toBe(true);
    // cleanup
    await rm(join(CACHE_ROOT, digestOf(projectA)), { recursive: true, force: true });
  });

  test("token pattern rejects ../, absolute path, empty", async () => {
    expect(await load(projectA, "../")).toBeUndefined();
    expect(await load(projectA, "/abs/path")).toBeUndefined();
    expect(await load(projectA, "")).toBeUndefined();
  });

  test("directory with no manifest loads as undefined", async () => {
    const d = digestOf(projectA);
    const dir = join(CACHE_ROOT, d, "sometoken");
    await mkdir(dir, { recursive: true });
    expect(await load(projectA, "sometoken")).toBeUndefined();
    await rm(join(CACHE_ROOT, d), { recursive: true, force: true });
  });

  test("missing row file loads as undefined", async () => {
    const e = await write(projectA, makeRead("pr"));
    const first = e.rows[0];
    if (first === undefined) throw new Error("expected a row");
    await rm(first.rows);
    expect(await load(projectA, e.token)).toBeUndefined();
    await rm(join(CACHE_ROOT, digestOf(projectA)), { recursive: true, force: true });
  });

  test("malformed manifest loads as undefined", async () => {
    const d = digestOf(projectA);
    const dir = join(CACHE_ROOT, d, "badman");
    await mkdir(dir, { recursive: true });
    await Bun.write(
      join(dir, "manifest.json"),
      JSON.stringify({ token: "badman", subject: 123, cross: {}, problems: [], rows: [] }),
    );
    expect(await load(projectA, "badman")).toBeUndefined();
    await rm(join(CACHE_ROOT, d), { recursive: true, force: true });
  });

  test("row file with wrong shape loads as undefined", async () => {
    const e = await write(projectA, makeRead("pr"));
    const first = e.rows[0];
    if (first === undefined) throw new Error("expected a row");
    await Bun.write(first.rows, JSON.stringify({ nope: true }));
    expect(await load(projectA, e.token)).toBeUndefined();
    await rm(join(CACHE_ROOT, digestOf(projectA)), { recursive: true, force: true });
  });

  test("manifest row.rows pointing outside token dir loads as undefined", async () => {
    const e = await write(projectA, makeRead("pr"));
    const manifestPath = join(e.directory, "manifest.json");
    const manifest = JSON.parse(await Bun.file(manifestPath).text());
    manifest.rows[0].rows = "/etc/passwd";
    await Bun.write(manifestPath, JSON.stringify(manifest));
    expect(await load(projectA, e.token)).toBeUndefined();
    await rm(join(CACHE_ROOT, digestOf(projectA)), { recursive: true, force: true });
  });

  test("write then load returns same subject, cross, problems, rows, files", async () => {
    const r = makeRead("pr");
    const e = await write(projectA, r);
    const loaded = await load(projectA, e.token);
    if (loaded === undefined) throw new Error("expected evidence");
    expect(loaded.subject).toEqual(e.subject);
    expect(loaded.cross).toEqual(e.cross);
    expect(loaded.problems).toEqual(e.problems);
    expect(loaded.rows).toEqual(e.rows);
    expect(loaded.files).toEqual(e.files);
    await rm(join(CACHE_ROOT, digestOf(projectA)), { recursive: true, force: true });
  });

  test("prune removes only old dirs under this project's digest", async () => {
    const dA = digestOf(projectA);
    const dB = digestOf(projectB);
    const now = Date.now();
    const oldTime = now - 8 * 24 * 60 * 60 * 1000;
    // old dir in project A
    const oldA = join(CACHE_ROOT, dA, "old-token-a");
    await mkdir(oldA, { recursive: true });
    await utimes(oldA, oldTime / 1000, oldTime / 1000);
    // fresh dir in project A
    const freshA = join(CACHE_ROOT, dA, "fresh-token-a");
    await mkdir(freshA, { recursive: true });
    // old dir in project B
    const oldB = join(CACHE_ROOT, dB, "old-token-b");
    await mkdir(oldB, { recursive: true });
    await utimes(oldB, oldTime / 1000, oldTime / 1000);

    await write(projectA, makeRead("pr"), now);

    const oldAExists = await Bun.file(oldA)
      .stat()
      .then(() => true)
      .catch(() => false);
    const freshAExists = await Bun.file(freshA)
      .stat()
      .then(() => true)
      .catch(() => false);
    const oldBExists = await Bun.file(oldB)
      .stat()
      .then(() => true)
      .catch(() => false);
    expect(oldAExists).toBe(false);
    expect(freshAExists).toBe(true);
    expect(oldBExists).toBe(true);

    // cleanup
    await rm(join(CACHE_ROOT, dA), { recursive: true, force: true });
    await rm(join(CACHE_ROOT, dB), { recursive: true, force: true });
  });

  test("two project directories get different digests", () => {
    expect(digestOf(projectA)).not.toBe(digestOf(projectB));
  });
});
