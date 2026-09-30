import { afterAll, describe, expect, test } from "bun:test";
import {
  BASES,
  branchProblem,
  mismatch,
  nameProblem,
  refusal,
  startProblem,
  type Start,
} from "../../tools/definitions/worktrees/classify";
import { bareOf, listed, mainOf, toplevel, type ListedWorktree } from "../../tools/definitions/worktrees/read";

const row = (directory: string, branch?: string, bare?: boolean): ListedWorktree => ({
  directory,
  ...(branch === undefined ? {} : { branch }),
  ...(bare === undefined ? {} : { bare }),
});

/** This project's own shape: a bare repository, then main, then a feature. */
const BARE_LAYOUT: ReadonlyArray<ListedWorktree> = [
  row("/dev/spectre", undefined, true),
  row("/dev/spectre-worktrees/main", "main"),
  row("/dev/spectre-worktrees/spectre-agent", "spectre-agent"),
];

const clean: Start = {
  name: "fix-login",
  branch: "fix-login",
  root: "/dev/spectre-worktrees",
  base: "origin/main",
  branchExists: false,
  sessionDirectory: "/dev/spectre-worktrees/main",
  rows: BARE_LAYOUT,
};

describe("name", () => {
  test("lowercase kebab-case is accepted", () => {
    expect(nameProblem("fix-login")).toBeUndefined();
    expect(nameProblem("a")).toBeUndefined();
    expect(nameProblem("fix-2")).toBeUndefined();
  });

  test("anything that is not kebab-case is rejected", () => {
    const kebab =
      "name must be lowercase kebab-case: letters and digits, single hyphens between them";
    expect(nameProblem("Fix-Login")).toBe(kebab);
    expect(nameProblem("fix_login")).toBe(kebab);
    expect(nameProblem("fix--login")).toBe(kebab);
    expect(nameProblem("-fix")).toBe(kebab);
    expect(nameProblem("fix-")).toBe(kebab);
  });

  test("the length bound is the number, not a feeling", () => {
    expect(nameProblem("a".repeat(40))).toBeUndefined();
    expect(nameProblem("a".repeat(41))).toBe("name is longer than 40 characters");
  });

  test("empty is its own message, not a pattern failure", () => {
    expect(nameProblem("")).toBe("name is empty");
  });
});

describe("branch", () => {
  test("ordinary branch names pass", () => {
    expect(branchProblem("fix-login")).toBeUndefined();
    expect(branchProblem("feature/JIRA-12")).toBeUndefined();
    expect(branchProblem("release_1.2")).toBeUndefined();
  });

  test("the refs git reads as something other than a branch name are refused", () => {
    expect(branchProblem("-leading")).toBe("branch may not start with a hyphen");
    expect(branchProblem("trailing/")).toBe("branch may not start or end with a slash");
    expect(branchProblem("a//b")).toBe("branch may not contain //");
    expect(branchProblem("a..b")).toBe("branch may not contain ..");
    expect(branchProblem("x.lock")).toBe("branch may not end in .lock");
    expect(branchProblem("with space")).toBe(
      "branch has a character git does not allow in a ref name",
    );
  });

  test("a name is checked before the branch, so one message is reported rather than two", () => {
    expect(startProblem("Bad Name", "also bad!")).toBe(
      "name must be lowercase kebab-case: letters and digits, single hyphens between them",
    );
  });
});

describe("reading the worktree list", () => {
  test("main is the worktree on main, not the first entry", () => {
    // The first entry of a bare-plus-worktrees project is the bare repository.
    // Reading it as main would refuse every start on this layout.
    expect(mainOf(BARE_LAYOUT)).toBe("/dev/spectre-worktrees/main");
    expect(mainOf(BARE_LAYOUT)).not.toBe(BARE_LAYOUT[0]?.directory);
  });

  test("the bare repository is found, and it is the anchor for the worktree directory", () => {
    expect(bareOf(BARE_LAYOUT)).toBe("/dev/spectre");
  });

  test("an ordinary checkout has no bare entry", () => {
    expect(bareOf([row("/code/app", "main")])).toBeUndefined();
    expect(mainOf([row("/code/app", "main"), row("/code/app-wt", "feature")])).toBe("/code/app");
  });
});

describe("one worktree per session", () => {
  test("a session in the main worktree is allowed", () => {
    expect(refusal(clean)).toBeUndefined();
  });

  test("a session already in a worktree is refused, naming both directories", () => {
    const blocked = refusal({
      ...clean,
      sessionDirectory: "/dev/spectre-worktrees/spectre-agent",
    });
    expect(blocked?.kind).toBe("wrong-session");
    expect(blocked?.why).toBe(
      "this session is already in /dev/spectre-worktrees/spectre-agent, which is not the main worktree (/dev/spectre-worktrees/main). One worktree per session: move back to /dev/spectre-worktrees/main, or work where you are.",
    );
  });

  test("a call with no session at all is refused rather than creating a worktree nobody moves into", () => {
    const blocked = refusal({ ...clean, sessionDirectory: undefined });
    expect(blocked?.kind).toBe("wrong-session");
    expect(blocked?.why).toContain("no session");
  });

  test("the session rules come before the filesystem ones, so a nested call gets the nesting answer", () => {
    const blocked = refusal({
      ...clean,
      sessionDirectory: "/dev/spectre-worktrees/spectre-agent",
      branchExists: true,
      base: undefined,
    });
    expect(blocked?.kind).toBe("wrong-session");
  });
});

describe("the rest of the refusals", () => {
  test("a taken worktree name is refused, and says what the host would otherwise do", () => {
    const blocked = refusal({
      ...clean,
      rows: [...BARE_LAYOUT, row("/dev/spectre-worktrees/fix-login", "fix-login")],
    });
    expect(blocked?.kind).toBe("already-taken");
    expect(blocked?.why).toBe(
      "a worktree named fix-login already exists at /dev/spectre-worktrees/fix-login, and the host would silently create fix-login-2 instead",
    );
  });

  test("a branch that exists under a different directory is still refused", () => {
    expect(refusal({ ...clean, branchExists: true })?.kind).toBe("already-taken");
  });

  test("an unresolved base is refused and names what it tried", () => {
    const blocked = refusal({ ...clean, base: undefined });
    expect(blocked?.kind).toBe("no-base");
    expect(blocked?.why).toContain("origin/HEAD, origin/main, main, HEAD");
  });

  test("an invalid name is refused before anything about the repository", () => {
    expect(refusal({ ...clean, name: "Bad Name", branch: "Bad Name" })?.kind).toBe("invalid");
  });
});

describe("the read-back that certifies a worktree", () => {
  const good = { listed: true, head: "abc", expected: "abc", branch: "fix-login", wanted: "fix-login" };

  test("three agreeing reads certify it", () => {
    expect(mismatch(good)).toBeUndefined();
  });

  test("a directory git does not list is not a worktree", () => {
    expect(mismatch({ ...good, listed: false })).toBe("git does not list the directory");
  });

  test("a HEAD that is not the base says so with both commits", () => {
    expect(mismatch({ ...good, head: "def" })).toBe("HEAD is def, and the base resolved to abc");
  });

  test("a worktree still on the wrong branch is caught, which is what a detached create leaves behind", () => {
    expect(mismatch({ ...good, branch: "HEAD", wanted: "fix-login" })).toBe(
      "it is on HEAD, not fix-login",
    );
  });
});

describe("the base order", () => {
  test("trunk is preferred over the checkout's own HEAD, which is how a worktree gets cut off a feature", () => {
    expect(BASES.indexOf("origin/HEAD")).toBeLessThan(BASES.indexOf("HEAD"));
    expect(BASES.indexOf("origin/main")).toBeLessThan(BASES.indexOf("HEAD"));
  });
});

describe("parsing real git output", () => {
  const roots: Array<string> = [];
  let seq = 0;

  afterAll(async () => {
    for (const one of roots) await Bun.$`rm -rf ${one}`.quiet();
  });

  /**
   * The parser is only worth anything against what git actually prints, and the
   * case that matters is this project's: a bare repository listed FIRST, with
   * `main` second. A parser that trusted the order would report the bare path as
   * main and refuse every start.
   */
  test("a bare-plus-worktrees repository parses into main, not the bare path", async () => {
    const base = `${Bun.env.TMPDIR ?? "/tmp"}/spectre-wt-parse-${process.pid}-${seq++}`;
    roots.push(base);
    await Bun.write(`${base}/.keep`, "");
    const git = (args: ReadonlyArray<string>) =>
      Bun.spawn(["git", ...args], { cwd: base, stdout: "pipe", stderr: "pipe" }).exited;

    await git(["init", "-q", "--bare", `${base}/spectre`]);
    // Seeded from a throwaway clone so the only worktrees in the set are the two
    // this test creates; a lingering seed repo would be a third.
    await git(["clone", "-q", `${base}/spectre`, `${base}/seed`]);
    await Bun.write(`${base}/seed/a.txt`, "one\n");
    await git(["-C", `${base}/seed`, "add", "."]);
    await git([
      "-C", `${base}/seed`, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init",
    ]);
    await git(["-C", `${base}/seed`, "push", "-q", `${base}/spectre`, "HEAD:refs/heads/main"]);
    await git(["-C", `${base}/spectre`, "worktree", "add", "-q", `${base}/spectre-worktrees/main`, "main"]);
    await git([
      "-C", `${base}/spectre-worktrees/main`, "worktree", "add", "-q", "-b", "fix-login",
      `${base}/spectre-worktrees/fix-login`,
    ]);
    await Bun.$`rm -rf ${`${base}/seed`}`.quiet();

    const listing = await listed(`${base}/spectre-worktrees/main`);
    if (listing.kind !== "listed") throw new Error(`expected a listing, got ${listing.why}`);
    const rows = listing.rows;
    // What git prints, not what TMPDIR spells: macOS resolves `/var` to
    // `/private/var`, and the parser reports git's own paths on purpose.
    const main = await toplevel(`${base}/spectre-worktrees/main`);

    expect(rows.length).toBe(3);
    // The bare entry is the first one and carries no branch, which is why
    // position alone cannot answer either question.
    expect(rows[0]?.bare).toBe(true);
    expect(rows[0]?.branch).toBeUndefined();
    expect(mainOf(rows)).toBe(main);
    expect(mainOf(rows)).not.toBe(rows[0]?.directory);
    expect(bareOf(rows)).toBe(rows[0]?.directory);
    expect(rows.map((one) => one.branch)).toContain("fix-login");
  });

  test("an ordinary checkout has no bare entry and reports main first", async () => {
    const base = `${Bun.env.TMPDIR ?? "/tmp"}/spectre-wt-plain-${process.pid}-${seq++}`;
    roots.push(base);
    await Bun.write(`${base}/.keep`, "");
    const git = (args: ReadonlyArray<string>) =>
      Bun.spawn(["git", ...args], { cwd: base, stdout: "pipe", stderr: "pipe" }).exited;

    await git(["init", "-q", "-b", "main", `${base}/app`]);
    await Bun.write(`${base}/app/a.txt`, "one\n");
    await git(["-C", `${base}/app`, "add", "."]);
    await git([
      "-C", `${base}/app`, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init",
    ]);

    const listing = await listed(`${base}/app`);
    if (listing.kind !== "listed") throw new Error(`expected a listing, got ${listing.why}`);
    const rows = listing.rows;
    // Compared against what git says, not against a spelling of the path: on
    // macOS TMPDIR is `/var/...` and git resolves that to `/private/var/...`.
    const resolved = await toplevel(`${base}/app`);

    expect(bareOf(rows)).toBeUndefined();
    expect(resolved).toBeDefined();
    expect(mainOf(rows)).toBe(resolved!);
    // The one porcelain parser also reads HEAD, which the survey needs for `ageDays`.
    expect(rows).toEqual([
      { directory: resolved!, branch: "main", head: expect.stringMatching(/^[0-9a-f]{40}$/) },
    ]);
  });

  test("a directory reached through a symlink resolves to the same worktree", async () => {
    const base = `${Bun.env.TMPDIR ?? "/tmp"}/spectre-wt-link-${process.pid}-${seq++}`;
    roots.push(base);
    await Bun.write(`${base}/.keep`, "");
    const git = (args: ReadonlyArray<string>) =>
      Bun.spawn(["git", ...args], { cwd: base, stdout: "pipe", stderr: "pipe" }).exited;

    await git(["init", "-q", "-b", "main", `${base}/real`]);
    await Bun.write(`${base}/real/a.txt`, "one\n");
    await git(["-C", `${base}/real`, "add", "."]);
    await git([
      "-C", `${base}/real`, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init",
    ]);
    await Bun.$`ln -s ${`${base}/real`} ${`${base}/link`}`.quiet();

    // The reason the session's directory is resolved by git rather than compared
    // as a string: these two spellings differ and mean the same directory.
    expect(await toplevel(`${base}/link`)).toBe(await toplevel(`${base}/real`));
  });
});
