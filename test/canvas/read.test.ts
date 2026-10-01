import { describe, expect, test } from "bun:test";
import {
  crossChecked,
  diffArgs,
  gitDiffArgs,
  pullRequestUrl,
  read,
  refOf,
  revParseArgs,
  slugOf,
  stateOf,
  totalsOf,
  viewArgs,
} from "../../tools/definitions/canvas/read";

describe("stateOf", () => {
  // `gh pr view --json state` reports these three, uppercase. Asserted against
  // literals because the whole rule is that an unrecognised value is not a
  // fourth state: it is nothing, and the caller reports that.
  test("maps the three states gh reports", () => {
    expect(stateOf("OPEN")).toBe("open");
    expect(stateOf("CLOSED")).toBe("closed");
    expect(stateOf("MERGED")).toBe("merged");
  });

  test("refuses anything else rather than inventing a fourth state", () => {
    expect(stateOf("DRAFT")).toBeUndefined();
    expect(stateOf("open")).toBeUndefined();
    expect(stateOf("")).toBeUndefined();
    expect(stateOf("MERGED ")).toBeUndefined();
  });
});

describe("refOf", () => {
  test("accepts the characters a branch or tag name is made of", () => {
    expect(refOf("main")).toBe("main");
    expect(refOf("HEAD")).toBe("HEAD");
    expect(refOf("v1.2.3-rc1")).toBe("v1.2.3-rc1");
    expect(refOf("release/2.0")).toBe("release/2.0");
    expect(refOf("c002efd49bb99af060acea1aee1a894f85ff85c5")).toBe(
      "c002efd49bb99af060acea1aee1a894f85ff85c5",
    );
  });

  // `Bun.spawn` passes argv, so there is no shell to break out of. What `gh`
  // and `git` do break out of is their own flag parser, which is why a leading
  // dash is refused here rather than downstream.
  test("refuses anything that would read as a flag", () => {
    expect(refOf("--repo")).toBeUndefined();
    expect(refOf("-x")).toBeUndefined();
    expect(refOf("--version; rm -rf /")).toBeUndefined();
  });

  test("refuses traversal and empty segments", () => {
    expect(refOf("../etc")).toBeUndefined();
    expect(refOf("a/../b")).toBeUndefined();
    expect(refOf("a//b")).toBeUndefined();
    expect(refOf("")).toBeUndefined();
    expect(refOf("main ")).toBeUndefined();
    expect(refOf("main;git")).toBeUndefined();
    expect(refOf("ma\nin")).toBeUndefined();
    expect(refOf("main~1")).toBeUndefined();
  });
});

describe("slugOf", () => {
  test("accepts owner/name", () => {
    expect(slugOf("yriveiro/spectre")).toBe("yriveiro/spectre");
  });

  test("refuses three segments, one segment, and a traversal", () => {
    expect(slugOf("yriveiro/spectre/extra")).toBeUndefined();
    expect(slugOf("spectre")).toBeUndefined();
    expect(slugOf("../spectre")).toBeUndefined();
    expect(slugOf("yriveiro/../spectre")).toBeUndefined();
    expect(slugOf("--repo/spectre")).toBeUndefined();
  });
});

describe("pullRequestUrl", () => {
  test("reads the repository and the number out of a pull request URL", () => {
    expect(pullRequestUrl("https://github.com/yriveiro/spectre/pull/16")).toEqual({
      ok: true,
      repository: "yriveiro/spectre",
      number: 16,
    });
  });

  test("refuses anything that is not a pull request URL on github.com", () => {
    expect(pullRequestUrl("https://github.com/yriveiro/spectre/pull/16/files").ok).toBe(false);
    expect(pullRequestUrl("https://github.com/yriveiro/spectre/issues/16").ok).toBe(false);
    expect(pullRequestUrl("http://github.com/yriveiro/spectre/pull/16").ok).toBe(false);
    expect(pullRequestUrl("https://gitlab.com/yriveiro/spectre/pull/16").ok).toBe(false);
    expect(pullRequestUrl("16").ok).toBe(false);
    expect(pullRequestUrl("").ok).toBe(false);
  });

  // The reason this is its own arm rather than `repo` plus `pr`: the repository
  // a URL names must be one this reader will accept, and a wrong repository
  // with a valid number is a different pull request rather than an error.
  test("refuses a URL whose repository is not allowlisted", () => {
    expect(pullRequestUrl("https://github.com/--repo/spectre/pull/16").ok).toBe(false);
    expect(pullRequestUrl("https://github.com/yriveiro/spec tre/pull/16").ok).toBe(false);
    expect(pullRequestUrl("https://github.com/../spectre/pull/16").ok).toBe(false);
  });

  test("refuses a URL with no number or a zero number", () => {
    expect(pullRequestUrl("https://github.com/yriveiro/spectre/pull/").ok).toBe(false);
    expect(pullRequestUrl("https://github.com/yriveiro/spectre/pull/0").ok).toBe(false);
  });

  test("says why it refused", () => {
    const refused = pullRequestUrl("not a url");
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error("unreachable");
    expect(refused.why).toContain("not a GitHub pull request URL");
  });
});

describe("argument construction", () => {
  // `--patch` is absent from `diffArgs` and its absence is the measurement in
  // the design: on this repo's PR 16, `--patch` counts 3 extra deletions from
  // the commit-message prose.
  test("asks gh for the whole metadata header in one call", () => {
    expect(viewArgs("16")).toEqual([
      "pr",
      "view",
      "16",
      "--json",
      "number,title,state,baseRefName,headRefName,headRefOid,additions,deletions,changedFiles,url,author,body,isDraft",
    ]);
  });

  test("asks for the plain diff and never for patch", () => {
    expect(diffArgs("16")).toEqual(["pr", "diff", "16", "--color", "never"]);
    expect(diffArgs("16").includes("--patch")).toBe(false);
  });

  test("differs a local base against a local head, colourless", () => {
    expect(gitDiffArgs("main", "feature")).toEqual(["diff", "--no-color", "main...feature"]);
  });

  test("pins the head commit before resolving it", () => {
    expect(revParseArgs("feature")).toEqual([
      "rev-parse",
      "--verify",
      "--quiet",
      "feature^{commit}",
    ]);
  });
});

describe("crossChecked", () => {
  // The measured failure in the design is a count that is slightly wrong and
  // looks fine. These three arms are what stops it: exact agreement, a stated
  // disagreement, and no oracle at all.
  test("reports agreement when every count is equal", () => {
    const totals = { files: 88, additions: 458, deletions: 703 };
    expect(crossChecked(totals, totals)).toEqual({
      kind: "matched",
      parsed: totals,
      reported: totals,
    });
  });

  test("reports the disagreement rather than passing it", () => {
    const parsed = { files: 1, additions: 56, deletions: 18 };
    const reported = { files: 1, additions: 56, deletions: 15 };
    const found = crossChecked(parsed, reported);
    expect(found.kind).toBe("mismatched");
    if (found.kind !== "mismatched") throw new Error("unreachable");
    expect(found.why).toBe("parsed 56/18 against gh's 56/15");
  });

  test("a file-count disagreement is a disagreement too", () => {
    const parsed = { files: 87, additions: 458, deletions: 703 };
    const reported = { files: 88, additions: 458, deletions: 703 };
    const found = crossChecked(parsed, reported);
    expect(found.kind).toBe("mismatched");
    if (found.kind !== "mismatched") throw new Error("unreachable");
    expect(found.why).toBe("parsed 87 files against gh's 88");
  });
});

describe("totalsOf", () => {
  // Literals, and the addition is counted by hand below the expect: three added
  // lines and one removed one, plus a file with no rows at all.
  test("adds up parsed files and ignores the ones that carry no rows", () => {
    expect(
      totalsOf([
        { status: "read", index: 1, path: "a.ts", rows: [], additions: 3, deletions: 1 },
        { status: "unreadable", index: 2, path: "logo.png", reason: "binary file, no text rows" },
      ]),
    ).toEqual({ files: 2, additions: 3, deletions: 1 });
  });

  test("an empty diff is zero files, not an unreadable one", () => {
    expect(totalsOf([])).toEqual({ files: 0, additions: 0, deletions: 0 });
  });
});

describe("refusals returned as data", () => {
  // These call the real `git`, which is on PATH, so they cannot pass vacuously.
  // A refusal is a value with a `problem` on it, never a throw and never a
  // subject that names a pull request nobody read.
  //
  // The two casts below are what the tool's schema makes unrepresentable before
  // this function runs. They reach the guard on purpose: a guard no input can
  // reach is a check that cannot fail.
  test("a local diff without both refs is refused, and neither is inferred", async () => {
    const one = await read(process.cwd(), { base: "main" } as never);
    expect(one.status).toBe("refused");
    if (one.status !== "refused") throw new Error("unreachable");
    expect(one.problem).toContain("both `base` and `head`");

    const two = await read(process.cwd(), { head: "main" } as never);
    expect(two.status).toBe("refused");
    if (two.status !== "refused") throw new Error("unreachable");
    expect(two.problem).toContain("both `base` and `head`");
  });

  test("a base outside the allowlist is refused before git is run", async () => {
    const result = await read(process.cwd(), {
      base: "--upload-pack=touch /tmp/pwned",
      head: "main",
    });
    expect(result.status).toBe("refused");
    if (result.status !== "refused") throw new Error("unreachable");
    expect(result.problem).toContain("base ref is not an allowlisted ref");
  });

  test("a head outside the allowlist is refused before git is run", async () => {
    const result = await read(process.cwd(), { base: "main", head: "-x" });
    expect(result.status).toBe("refused");
    if (result.status !== "refused") throw new Error("unreachable");
    expect(result.problem).toContain("head ref is not an allowlisted ref");
  });

  test("a head that resolves to no commit is refused, not read as empty", async () => {
    const result = await read(process.cwd(), { base: "main", head: "no-such-ref-here" });
    expect(result.status).toBe("refused");
    if (result.status !== "refused") throw new Error("unreachable");
    expect(result.problem).toContain("does not resolve to a commit");
  });

  test("a url that is not a pull request URL is refused without calling gh", async () => {
    const result = await read(process.cwd(), { url: "https://example.com/not/a/pr" });
    expect(result.status).toBe("refused");
    if (result.status !== "refused") throw new Error("unreachable");
    expect(result.problem).toContain("not a GitHub pull request URL");
  });

  test("a number that is not a pull request number is refused", async () => {
    const result = await read(process.cwd(), { pr: 0 });
    expect(result.status).toBe("refused");
    if (result.status !== "refused") throw new Error("unreachable");
    expect(result.problem).toContain("not a pull request number");
  });
});

/**
 * The two shas a real local diff in this checkout, read with git rather than
 * written here: HEAD's first parent against HEAD. `HEAD~1` is not a ref this
 * reader accepts, so the test resolves it to a sha and passes the sha.
 */
const parentAndHead = async () => {
  const proc = Bun.spawn(["git", "rev-parse", "HEAD^", "HEAD"], { stdout: "pipe", stderr: "pipe" });
  const [out] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  const [base, head] = out.trim().split("\n");
  if (base === undefined || head === undefined) throw new Error(`git rev-parse: ${out}`);
  return { base, head };
};

describe("a local diff that is real", () => {
  // A real diff in this checkout, read through the real `git`, and it names no
  // pull request: the subject's only fields are the two refs and the resolved
  // head sha.
  test("reads a local diff and claims no pull request", async () => {
    const { base, head } = await parentAndHead();
    const result = await read(process.cwd(), { base, head });
    if (result.status !== "read") throw new Error(`refused: ${result.problem}`);
    if (result.subject.kind !== "local-diff") throw new Error("unreachable");
    expect(result.subject.base).toBe(base);
    expect(result.subject.headSha).toBe(head);
    expect(result.problems).toEqual([]);
    expect(result.files.length).toBeGreaterThan(0);
  });

  test("a local diff has no cross-check to pass, and says so", async () => {
    const { base, head } = await parentAndHead();
    const result = await read(process.cwd(), { base, head });
    if (result.status !== "read") throw new Error(`refused: ${result.problem}`);
    expect(result.cross.kind).toBe("no-oracle");
    if (result.cross.kind !== "no-oracle") throw new Error("unreachable");
    expect(result.cross.parsed.files).toBe(result.files.length);
    expect(result.cross.parsed.additions).toBe(
      result.files.reduce((sum, one) => sum + (one.status === "read" ? one.additions : 0), 0),
    );
  });

  test("the local-diff subject carries no number, url, title, author or state", async () => {
    const { base, head } = await parentAndHead();
    const result = await read(process.cwd(), { base, head });
    if (result.status !== "read") throw new Error(`refused: ${result.problem}`);
    if (result.subject.kind !== "local-diff") throw new Error("unreachable");
    expect(Object.keys(result.subject).toSorted()).toEqual(["base", "head", "headSha", "kind"]);
  });
});
