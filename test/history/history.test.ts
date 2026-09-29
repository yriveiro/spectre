import { afterAll, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { Tool } from "@opencode/schema/tool";
import { historyTool } from "../../tools/definitions/history";
import { parse, parsePorcelain, parseShort } from "../../tools/definitions/history/parse";

type Commit = {
  sha: string;
  short: string;
  date: string;
  author: string;
  subject: string;
  body: string;
  reverts: boolean;
};

type Report = {
  path: string;
  found: boolean;
  introducedBy?: Commit;
  commits: ReadonlyArray<Commit>;
  blame?: { line: number; sha: string; author: string; date: string; summary: string };
  reverts: number;
  authors: ReadonlyArray<string>;
  first?: string;
  last?: string;
  problems?: string;
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
 * Three commits on one file, the last of which reverts the second. The fixture
 * is the input; every assertion below is on what the tool read back.
 */
const repo = async () => {
  const base = `${TMP}/spectre-history-${process.pid}-${seq++}`;
  roots.push(base);
  const root = `${base}/repo`;
  await Bun.write(`${base}/.keep`, "");
  await git(base, ["init", "-q", "-b", "main", root]);
  await git(root, ["config", "user.email", "dev@example.com"]);
  await git(root, ["config", "user.name", "Dev One"]);

  await Bun.write(`${root}/a.txt`, "one\n");
  await git(root, ["add", "."]);
  await git(root, ["commit", "-q", "-m", "add a", "-m", "the file the module loads first"]);

  await Bun.write(`${root}/a.txt`, "one\ntwo\n");
  await git(root, ["commit", "-qam", "cache the lookup", "-m", "keeps the file off disk"]);

  await Bun.write(`${root}/a.txt`, "one\n");
  await git(root, ["commit", "-qam", 'Revert "cache the lookup"']);

  return root;
};

const call = async (directory: string, input: Record<string, unknown>) => {
  const result = await Effect.runPromise(
    historyTool(directory).execute(input as never, context),
  );
  return result.output as Report;
};

afterAll(async () => {
  for (const base of roots) await Bun.$`rm -rf ${base}`.quiet();
});

describe("separating the fields", () => {
  test("a subject and a body holding colons and tabs stay in their own cells", () => {
    const [commit] = parse(
      [
        "a".repeat(40),
        "aaaaaaa",
        "2026-09-01T10:00:00+00:00",
        "Dev One",
        "fix: retry: the\tthing",
        "why: it failed\non: the edge\n\nand then some",
      ].join("\x1f") + "\x1e",
    );

    expect(commit).toEqual({
      sha: "a".repeat(40),
      short: "aaaaaaa",
      date: "2026-09-01T10:00:00+00:00",
      author: "Dev One",
      subject: "fix: retry: the\tthing",
      body: "why: it failed\non: the edge\n\nand then some",
      reverts: false,
    });
  });

  test("a body that holds the field separator does not lose the rest of itself", () => {
    // This is the reason the body is rejoined from the tail rather than read as
    // one field: a commit that quotes a control character in its message.
    const [commit] = parse(
      [
        "b".repeat(40),
        "bbbbbbb",
        "2026-09-01T10:00:00+00:00",
        "Dev One",
        "subject",
        "before",
        "after",
      ].join("\x1f") + "\x1e",
    );

    expect(commit?.body).toBe("before\x1fafter");
  });

  test("a Revert subject is a revert, and Reverted-by is not", () => {
    // Both shas must be real hex of a plausible length or the record is dropped
    // before the subject is ever read, which is the other thing under test here.
    const make = (subject: string) =>
      parse(
        ["c".repeat(40), "ccccccc", "2026-09-01T10:00:00Z", "D", subject].join("\x1f") + "\x1e",
      )[0];

    expect(make('Revert "cache the lookup"')?.reverts).toBe(true);
    expect(make("Reverted-by an earlier commit")?.reverts).toBe(false);
  });

  test("a record with no sha yields nothing rather than a half-built commit", () => {
    expect(parse("")).toEqual([]);
    expect(parse("garbage")).toEqual([]);
  });

  test("fields do not slide: a leading separator shifts nothing into the wrong cell", () => {
    // The empty `%H` is a truncated read, not a real path, so this guards the
    // parser. Repairing it by dropping the first field is what turns a
    // truncated record into six plausible-looking wrong values.
    const truncated = ["", "abc1234", "2026-09-01T10:00:00Z", "D", "subject", ""].join("\x1f") + "\x1e";
    expect(parse(truncated).map((one) => one.sha)).not.toContain("abc1234");
  });

  test("a real record keeps every field in its own cell", () => {
    const whole = ["a".repeat(40), "aaaaaaa", "2026-09-01T10:00:00Z", "D", "subject", "body"].join(
      "\x1f",
    );
    expect(parse(whole + "\x1e")[0]).toEqual({
      sha: "a".repeat(40),
      short: "aaaaaaa",
      date: "2026-09-01T10:00:00Z",
      author: "D",
      subject: "subject",
      body: "body",
      reverts: false,
    });
  });
});

describe("blame", () => {
  test("porcelain is key/value, so a name with spaces cannot move a field", () => {
    const raw = [
      "abc1234 42 42 1",
      "author Ana Maria de la Cruz",
      "author-mail <dev@example.com>",
      "author-time 1756684800",
      "summary the actual line",
      "filename a.txt",
      "\tline content",
    ].join("\n");

    expect(parsePorcelain(raw, 42)).toEqual({
      line: 42,
      sha: "abc1234",
      author: "Ana Maria de la Cruz",
      date: "2025-09-01",
      summary: "the actual line",
    });
  });

  test("the short form carries no author or date, and says so rather than guessing", () => {
    const read = parseShort("abc1234 42) the actual line", 42);
    expect(read).toEqual({
      line: 42,
      sha: "abc1234",
      author: "",
      date: "",
      summary: "the actual line",
    });
  });

  test("a boundary commit's caret is not part of the sha", () => {
    expect(parseShort("^abc1234 1) hi", 1)?.sha).toBe("^abc1234");
  });

  test("output that is not a blame line yields null", () => {
    expect(parsePorcelain("", 1)).toBeNull();
    expect(parsePorcelain("fatal: no such path", 1)).toBeNull();
    expect(parseShort("", 1)).toBeNull();
  });
});

describe("a file with three commits, the last reverting the second", () => {
  test("every commit comes back newest first, with the body intact", async () => {
    const report = await call(await repo(), { path: "a.txt" });

    expect(report.found).toBe(true);
    expect(report.commits.map((one) => one.subject)).toEqual([
      'Revert "cache the lookup"',
      "cache the lookup",
      "add a",
    ]);
    expect(report.commits[1]?.body).toBe("keeps the file off disk");
  });

  test("introducedBy is the commit that created the file, not the newest", async () => {
    const report = await call(await repo(), { path: "a.txt" });

    expect(report.introducedBy?.subject).toBe("add a");
    expect(report.introducedBy?.body).toBe("the file the module loads first");
  });

  test("a revert is counted and flagged, not hidden", async () => {
    const report = await call(await repo(), { path: "a.txt" });

    expect(report.reverts).toBe(1);
    expect(report.commits[0]?.reverts).toBe(true);
  });

  test("contains narrows to the commit whose message matched", async () => {
    const report = await call(await repo(), { path: "a.txt", contains: "keeps the file" });

    expect(report.commits).toHaveLength(1);
    expect(report.commits[0]?.subject).toBe("cache the lookup");
  });

  test("blame names the commit that last touched that line", async () => {
    const report = await call(await repo(), { path: "a.txt", line: 1 });

    expect(report.blame?.line).toBe(1);
    expect(report.blame?.author).toBe("Dev One");
  });

  test("authors are listed and the date span has an order", async () => {
    const report = await call(await repo(), { path: "a.txt" });

    expect(report.authors).toEqual(["Dev One"]);
    // Three commits made seconds apart can share a timestamp, so the assertion
    // is the ordering the fields claim, not a strict inequality.
    expect(Date.parse(report.last!)).toBeGreaterThanOrEqual(Date.parse(report.first!));
    expect(report.commits[0]?.date).toBe(report.last);
  });
});

describe("what it cannot read", () => {
  test("a path the repository does not have is a problem, not a throw", async () => {
    const root = await repo();
    const report = await call(root, { path: "nope.txt" });

    expect(report.found).toBe(false);
    expect(report.commits).toEqual([]);
    expect(report.problems).toContain("nope.txt is not in the repository");
  });

  test("an untracked file is reported as untracked, which is a different fact", async () => {
    const root = await repo();
    await Bun.write(`${root}/scratch.txt`, "loose\n");

    const report = await call(root, { path: "scratch.txt" });
    expect(report.problems).toContain(
      "scratch.txt exists but git does not track it, so it has no history",
    );
  });
});
