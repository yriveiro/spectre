import { afterAll, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { Tool } from "@opencode/schema/tool";
import { worktrees } from "../../tools/definitions/worktrees";

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

const call = async (directory: string) => {
  const result = await Effect.runPromise(worktrees(directory).execute({}, context));
  return result.output as {
    worktrees: ReadonlyArray<Row>;
    counts: Record<string, number>;
    problems?: string;
  };
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
