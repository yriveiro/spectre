import { afterAll, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { Plugin } from "@opencode/plugin/effect";
import type { Tool } from "@opencode/schema/tool";
import { AbsolutePath } from "@opencode/schema/schema";
import { worktrees } from "../../tools/definitions/worktrees";

const ctx = (directory: string) =>
  ({
    location: { project: { id: "test", directory: AbsolutePath.make(directory), canonical: AbsolutePath.make(directory) } },
  }) as unknown as Plugin.Context;

type Row = {
  path: string;
  branch: string;
  head: string;
  ageDays: number;
  merged: boolean;
  dirty: string;
  remote: string;
  pr: string;
  bucket: string;
};

const TMP = Bun.env.TMPDIR ?? "/tmp";
const roots: Array<string> = [];
let seq = 0;

const context = { progress: () => Effect.void } as unknown as Tool.Context;

const git = async (cwd: string, args: ReadonlyArray<string>) => {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  await proc.exited;
};

/**
 * A repository with one worktree on `feature`, its HEAD made an ancestor of
 * `origin/main` so the merge column has something true to read. Every assertion
 * below is on what the tool returned, never on the setup that produced it.
 */
const repo = async () => {
  const base = `${TMP}/spectre-worktrees-${process.pid}-${seq++}`;
  roots.push(base);
  const root = `${base}/repo`;
  const tree = `${base}/feature`;

  await Bun.write(`${base}/.keep`, "");
  await git(base, ["init", "-q", "-b", "main", root]);
  await git(root, ["config", "user.email", "test@example.com"]);
  await git(root, ["config", "user.name", "test"]);
  await Bun.write(`${root}/a.txt`, "one\n");
  await git(root, ["add", "."]);
  await git(root, ["commit", "-q", "-m", "first"]);
  await git(root, ["worktree", "add", "-q", "-b", "feature", tree]);
  await git(root, ["update-ref", "refs/remotes/origin/main", "HEAD"]);

  return { root, tree };
};

/**
 * This project's own layout: a bare repository, then `main` and a feature as its
 * siblings. The bare entry is reported first, so an audit that takes entry 0 as
 * main discards the bare path and lists the real `main` as a candidate — which is
 * the whole reason `audit.ts` filters on the branch and on `bare`.
 */
const bareLayout = async () => {
  const base = `${TMP}/spectre-bare-${process.pid}-${seq++}`;
  roots.push(base);
  const bare = `${base}/spectre`;
  const main = `${base}/spectre-worktrees/main`;
  const feature = `${base}/spectre-worktrees/feature`;

  await Bun.write(`${base}/.keep`, "");
  await git(base, ["init", "-q", "--bare", bare]);
  await git(base, ["clone", "-q", bare, `${base}/seed`]);
  await Bun.write(`${base}/seed/a.txt`, "one\n");
  await git(`${base}/seed`, ["add", "."]);
  await git(`${base}/seed`, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "first"]);
  await git(`${base}/seed`, ["push", "-q", bare, "HEAD:refs/heads/main"]);
  await git(bare, ["worktree", "add", "-q", main, "main"]);
  await git(main, ["worktree", "add", "-q", "-b", "feature", feature]);
  await git(main, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
  await Bun.$`rm -rf ${`${base}/seed`}`.quiet();

  return { bare, main, feature };
};

/**
 * The survey branch, narrowed by the presence of rows. `repo` is passed
 * explicitly rather than left to the context: the tool reads
 * `ctx.location.directory` as the default, and in this test that is the real
 * repository, so a fixture that relied on the default would silently assert on
 * this project's own worktrees.
 */
const call = async (directory: string) => {
  const result = await Effect.runPromise(
    worktrees(ctx(directory)).execute(
      { action: "list", repo: directory },
      { ...context, sessionID: "test" as never },
    ),
  );
  const output = result.output as
    | { worktrees: ReadonlyArray<Row>; counts: Record<string, number>; problems?: string }
    | { status: string };
  if (!("worktrees" in output))
    throw new Error(`expected a survey, got status ${output.status}`);
  return output;
};

/** Every fixture builds exactly one worktree, so anything else is a failure. */
const only = (rows: ReadonlyArray<Row>): Row => {
  if (rows.length !== 1) throw new Error(`expected 1 worktree, got ${rows.length}`);
  return rows[0]!;
};

afterAll(async () => {
  for (const base of roots) await Bun.$`rm -rf ${base}`.quiet();
});

describe("a worktree whose HEAD is already in origin/main", () => {
  test("buckets safe, and reports the branch, head, and remote state it read", async () => {
    const { root } = await repo();
    const page = await call(root);
    const row = only(page.worktrees);

    expect(row.branch).toBe("feature");
    expect(row.head).toMatch(/^[0-9a-f]{40}$/);
    expect(row.merged).toBe(true);
    expect(row.dirty).toBe("clean");
    expect(row.remote).toBe("no-remote");
    expect(row.pr).toBe("-");
    expect(row.bucket).toBe("safe");
    expect(page.counts.safe).toBe(1);
  });
});

describe("a worktree with tracked edits", () => {
  test("buckets hold-wip even though its HEAD is merged", async () => {
    const { root, tree } = await repo();
    await Bun.write(`${tree}/a.txt`, "changed\n");

    const row = only((await call(root)).worktrees);
    expect(row.merged).toBe(true);
    expect(row.dirty).toBe("wip:1");
    expect(row.bucket).toBe("hold-wip");
  });
});

describe("a worktree with only untracked files", () => {
  test("scratch is counted separately and does not hold the tree", async () => {
    const { root, tree } = await repo();
    await git(root, ["update-ref", "-d", "refs/remotes/origin/main"]);
    await Bun.write(`${tree}/scratch.txt`, "junk\n");

    const row = only((await call(root)).worktrees);
    expect(row.dirty).toBe("scratch:1");
    expect(row.bucket).toBe("review");
  });
});

describe("a bare repository with linked worktrees", () => {
  test("git orders the bare path first, and no row is the bare one or main", async () => {
    const { bare, main, feature } = await bareLayout();
    // git sorts these by directory, so the order it reports is the bare
    // repository, then feature, then main — neither "the first entry" nor "the
    // second" is main. Assert the order so a change to how rows are chosen fails
    // here rather than passing on a loose path comparison.
    const raw = await Bun.$`git -C ${main} worktree list --porcelain`.text();
    const blocks = raw.split("\n\n").filter((one) => one !== "");
    const order = blocks.map((block) =>
      block.split("\n").includes("bare")
        ? "BARE"
        : (block.match(/^worktree (.*)$/m)?.[1]?.split("/").pop() ?? "?"),
    );

    expect(order[0]).toBe("BARE");
    expect(order).toContain("main");
    expect(order).toContain("feature");

    const page = await call(main);
    const row = only(page.worktrees);

    // git's own spelling of the path: macOS resolves TMPDIR's `/var` to
    // `/private/var`, so the fixture's path and the row's differ.
    const endsWith = (p: string, tail: string) => p.endsWith(tail);
    expect(endsWith(row.path, "/spectre-worktrees/feature")).toBe(true);
    expect(row.branch).toBe("feature");
    // The bare repository and the main worktree are both reported by git and
    // neither is a cleanup candidate: one is not a worktree, the other is trunk.
    expect(page.worktrees.some((one) => endsWith(one.path, "/spectre"))).toBe(false);
    expect(page.worktrees.some((one) => endsWith(one.path, "/spectre-worktrees/main"))).toBe(false);
    expect(endsWith(bare, "/spectre")).toBe(true);
    expect(endsWith(feature, "/spectre-worktrees/feature")).toBe(true);
  });

  test("two feature worktrees are both listed, and neither the bare path nor main is", async () => {
    const base = `${TMP}/spectre-bare-two-${process.pid}-${seq++}`;
    roots.push(base);
    const bare = `${base}/spectre`;
    const main = `${base}/spectre-worktrees/main`;
    const second = `${base}/spectre-worktrees/second`;

    await Bun.write(`${base}/.keep`, "");
    await git(base, ["init", "-q", "--bare", bare]);
    await git(base, ["init", "-q", "-b", "main", `${base}/seed`]);
    await Bun.write(`${base}/seed/a.txt`, "one\n");
    await git(`${base}/seed`, ["add", "."]);
    await git(`${base}/seed`, [
      "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "first",
    ]);
    await git(`${base}/seed`, ["push", "-q", bare, "HEAD:refs/heads/main"]);
    await git(bare, ["worktree", "add", "-q", main, "main"]);
    await git(main, ["worktree", "add", "-q", "-b", "feature", `${base}/spectre-worktrees/feature`]);
    await git(main, ["worktree", "add", "-q", "-b", "other", second]);
    await git(main, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
    await Bun.$`rm -rf ${`${base}/seed`}`.quiet();

    const page = await call(main);
    const endsWith = (p: string, tail: string) => p.endsWith(tail);

    expect(page.worktrees.map((one) => one.branch).sort()).toEqual(["feature", "other"]);
    expect(page.worktrees.some((one) => endsWith(one.path, "/spectre"))).toBe(false);
    expect(page.worktrees.some((one) => endsWith(one.path, "/spectre-worktrees/main"))).toBe(false);
    expect(page.worktrees.some((one) => endsWith(one.path, "/spectre-worktrees/second"))).toBe(true);
  });
});

describe("what the tool cannot do", () => {
  test("a directory that is not a repository comes back as a problem, not a throw", async () => {
    const base = `${TMP}/spectre-worktrees-${process.pid}-${seq++}`;
    roots.push(base);
    await Bun.write(`${base}/plain.txt`, "not a repo\n");

    const page = await call(base);
    expect(page.worktrees).toEqual([]);
    expect(page.problems).toContain(`${base} is not a git repository`);
  });

  test("a repository with no origin/main says so instead of reporting nothing merged", async () => {
    const { root } = await repo();
    await git(root, ["update-ref", "-d", "refs/remotes/origin/main"]);

    const page = await call(root);
    expect(only(page.worktrees).merged).toBe(false);
    expect(page.problems).toContain(
      "origin/main is not fetched, so `merged` is false everywhere; fetch it before trusting `safe`",
    );
  });

  test("a repository with only a main worktree returns no rows", async () => {
    const base = `${TMP}/spectre-worktrees-${process.pid}-${seq++}`;
    roots.push(base);
    const root = `${base}/solo`;
    await Bun.write(`${base}/.keep`, "");
    await git(base, ["init", "-q", "-b", "main", root]);
    await git(root, ["config", "user.email", "test@example.com"]);
    await git(root, ["config", "user.name", "test"]);
    await Bun.write(`${root}/a.txt`, "one\n");
    await git(root, ["add", "."]);
    await git(root, ["commit", "-q", "-m", "first"]);
    await git(root, ["update-ref", "refs/remotes/origin/main", "HEAD"]);

    const page = await call(root);
    expect(page.worktrees).toEqual([]);
  });

  test("a repository gh cannot resolve names the reason rather than saying gh is broken", async () => {
    const base = `${TMP}/spectre-worktrees-${process.pid}-${seq++}`;
    roots.push(base);
    const root = `${base}/remote-less`;
    await Bun.write(`${base}/.keep`, "");
    await git(base, ["init", "-q", "-b", "main", root]);

    const { problems } = await call(root);
    const reported = problems ?? "";

    if (Bun.which("gh") === null) {
      expect(reported).toContain("`gh` is not on PATH");
      return;
    }
    // `gh` needs a remote. When one is absent the message must say so, because
    // "unauthenticated" would send the reader to fix the wrong thing.
    expect(reported).toContain("`gh pr list` failed:");
    expect(reported).toContain("every branch reads as having no PR");
  });
});
