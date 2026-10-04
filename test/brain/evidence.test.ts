import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { type EvidenceReport, evidence, WINDOW } from "../../tools/definitions/brain/evidence";

const TMP = Bun.env.TMPDIR ?? "/tmp";
const roots: Array<string> = [];
let seq = 0;

const fresh = (name: string): string => {
  const root = `${TMP}/spectre-evidence-${name}-${process.pid}-${seq++}`;
  roots.push(root);
  return root;
};

const git = async (
  cwd: string,
  args: ReadonlyArray<string>,
  env: Record<string, string> = {},
): Promise<string> => {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...Bun.env, ...env },
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`git ${args.join(" ")} exited ${code}: ${err.trim()}`);
  return out;
};

const stage = async (
  root: string,
  files: Record<string, string>,
  message: string,
  date: string,
): Promise<void> => {
  for (const [name, body] of Object.entries(files)) await Bun.write(`${root}/${name}`, body);
  await git(root, ["add", "-A"]);
  await git(root, ["commit", "-q", "-m", message], {
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
  });
};

const emptyRepo = async (root: string): Promise<void> => {
  await Bun.$`mkdir -p ${root}`.quiet();
  await git(root, ["init", "-q"]);
  await git(root, ["config", "user.email", "evidence@test.invalid"]);
  await git(root, ["config", "user.name", "evidence"]);
  await git(root, ["config", "commit.gpgsign", "false"]);
};

const historyRepo = async (): Promise<string> => {
  const root = fresh("history");
  await emptyRepo(root);
  await stage(root, { "a.txt": "a1\n", "b.txt": "b1\n" }, "seed", "2026-01-01T00:00:00 +0000");
  await Bun.$`mkdir -p ${root}/lib`.quiet();
  await stage(
    root,
    { "c.txt": "c1\n", "lib/inner.txt": "i1\n" },
    "add c",
    "2026-01-02T00:00:00 +0000",
  );
  await stage(root, { "a.txt": "a2\n", "b.txt": "b2\n" }, "edit both", "2026-01-03T00:00:00 +0000");
  return root;
};

const BULK = 205;

const bulkRepo = async (): Promise<string> => {
  const root = fresh("bulk");
  await emptyRepo(root);
  const head = (await git(root, ["symbolic-ref", "-q", "HEAD"])).trim();
  const start = Math.floor(Date.parse("2026-01-01T00:00:00Z") / 1000);
  let stream = "";
  for (let i = 0; i < BULK; i++) {
    const body = `a${i}\n`;
    stream += `blob\nmark :${i + 1}\ndata ${body.length}\n${body}`;
    stream += `commit ${head}\n`;
    stream += `committer evidence <evidence@test.invalid> ${start + i * 60} +0000\n`;
    const message = `c${i}\n`;
    stream += `data ${message.length}\n${message}`;
    stream += `M 100644 :${i + 1} a.txt\n\n`;
  }
  const proc = Bun.spawn(["git", "fast-import", "--quiet"], {
    cwd: root,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  proc.stdin.write(stream);
  proc.stdin.end();
  const [err, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) throw new Error(`fast-import exited ${code}: ${err.trim()}`);
  await git(root, ["reset", "-q"]);
  return root;
};

const ask = async (directory: string, subject: ReadonlyArray<string>): Promise<EvidenceReport> =>
  Effect.runPromise(evidence(directory, subject));

let history: string;
let bulk: string;

beforeAll(async () => {
  history = await historyRepo();
  bulk = await bulkRepo();
});

afterAll(async () => {
  for (const root of roots) await Bun.$`rm -rf ${root}`.quiet();
});

describe("a repository with history", () => {
  test("counts commits, co-change and last touch for every subject", async () => {
    const report = await ask(history, ["a.txt", "b.txt", "c.txt"]);
    expect(report).toEqual({
      rows: [
        { path: "a.txt", commits: 2, lastTouched: "2026-01-03T00:00:00Z", coChange: 1 },
        { path: "b.txt", commits: 2, lastTouched: "2026-01-03T00:00:00Z", coChange: 1 },
        { path: "c.txt", commits: 1, lastTouched: "2026-01-02T00:00:00Z", coChange: 0 },
      ],
      missing: [],
      problems: [],
    });
  });

  test("a path that is not in the repository is reported missing, not counted zero", async () => {
    const report = await ask(history, ["a.txt", "ghost.ts"]);
    expect(report).toEqual({
      rows: [{ path: "a.txt", commits: 2, lastTouched: "2026-01-03T00:00:00Z", coChange: 0 }],
      missing: ["ghost.ts"],
      problems: [],
    });
  });

  test("subjects that never share a commit report zero coupling", async () => {
    const report = await ask(history, ["a.txt", "c.txt"]);
    expect(report).toEqual({
      rows: [
        { path: "a.txt", commits: 2, lastTouched: "2026-01-03T00:00:00Z", coChange: 0 },
        { path: "c.txt", commits: 1, lastTouched: "2026-01-02T00:00:00Z", coChange: 0 },
      ],
      missing: [],
      problems: [],
    });
  });

  test("a directory subject is measured over what the directory contains", async () => {
    const report = await ask(history, ["lib", "c.txt"]);
    expect(report).toEqual({
      rows: [
        { path: "lib", commits: 1, lastTouched: "2026-01-02T00:00:00Z", coChange: 1 },
        { path: "c.txt", commits: 1, lastTouched: "2026-01-02T00:00:00Z", coChange: 1 },
      ],
      missing: [],
      problems: [],
    });
  });

  test("an empty subject needs no git at all", async () => {
    expect(await ask(history, [])).toEqual({ rows: [], missing: [], problems: [] });
  });
});

describe("no repository", () => {
  test("a directory that is not a repository returns the empty shape, not a throw", async () => {
    const root = fresh("plain");
    await Bun.$`mkdir -p ${root}`.quiet();
    await Bun.write(`${root}/a.txt`, "a1\n");
    const report = await ask(root, ["a.txt"]);
    expect(report).toEqual({ rows: [], missing: [], problems: ["not a git repository"] });
  });

  test("git missing from PATH is a reported problem, not a crash", async () => {
    const saved = process.env.PATH;
    process.env.PATH = "";
    try {
      expect(await ask(history, ["a.txt"])).toEqual({
        rows: [],
        missing: [],
        problems: ["git is not on PATH"],
      });
    } finally {
      process.env.PATH = saved;
    }
  });
});

describe("a repository whose history has not started", () => {
  test("a repository with no commits returns empty evidence, not zeros", async () => {
    const root = fresh("unborn");
    await emptyRepo(root);
    await Bun.write(`${root}/a.txt`, "a1\n");
    const report = await ask(root, ["a.txt"]);
    expect(report).toEqual({ rows: [], missing: ["a.txt"], problems: [] });
  });

  test("a log that fails is reported as a problem, not converted to rows", async () => {
    const root = fresh("staged");
    await emptyRepo(root);
    await Bun.write(`${root}/a.txt`, "a1\n");
    await git(root, ["add", "a.txt"]);
    const report = await ask(root, ["a.txt"]);
    expect(report.rows).toEqual([]);
    expect(report.missing).toEqual([]);
    expect(report.problems.join("\n")).toContain("git log failed");
  });
});

describe("the bounded window", () => {
  test("the window is 200 commits", () => {
    expect(WINDOW).toBe(200);
  });

  test("counts stop at the window instead of reading the whole history", async () => {
    const report = await ask(bulk, ["a.txt"]);
    expect(report).toEqual({
      rows: [{ path: "a.txt", commits: 200, lastTouched: "2026-01-01T03:24:00Z", coChange: 0 }],
      missing: [],
      problems: [],
    });
  });
});

describe("ambient git configuration", () => {
  test("an ambient GIT_DIR does not move the measurement off the working directory", async () => {
    process.env.GIT_DIR = `${bulk}/.git`;
    try {
      const report = await ask(history, ["a.txt"]);
      expect(report).toEqual({
        rows: [{ path: "a.txt", commits: 2, lastTouched: "2026-01-03T00:00:00Z", coChange: 0 }],
        missing: [],
        problems: [],
      });
    } finally {
      delete process.env.GIT_DIR;
    }
  });
});
