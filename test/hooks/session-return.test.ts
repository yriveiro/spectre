/**
 * The session-return hook's pure decision — `home` (the verdict) and `say` (the line
 * the session reads) — against literals. No host, no repository, no running session.
 */
import { describe, expect, test } from "bun:test";
import { AbsolutePath } from "@opencode/schema/schema";
import type { Session } from "@opencode/schema/session";
import { type Return, type Standing, home, say } from "../../tools/definitions/worktrees/return/home";

const SESSION = "ses_test" as Session.ID;
const LOST = AbsolutePath.make("/Users/x/dev/spectre-worktrees/fix-login");
const MAIN = AbsolutePath.make("/Users/x/dev/spectre");

const standing = (over: Partial<Standing> = {}): Standing => ({
  session: SESSION,
  where: { lost: LOST, onDisk: false },
  main: { kind: "found", directory: MAIN, dirty: { kind: "clean" } },
  behind: 0,
  branch: { kind: "named-by-git", name: "fix-login" },
  landing: { kind: "on-main", by: "ancestor" },
  ...over,
});

describe("the gate", () => {
  test("a session whose directory is still there is left alone, whatever the rest says", () => {
    expect(home(standing({ where: { lost: LOST, onDisk: true } }))).toEqual({ kind: "left-alone" });
  });

  test("left alone says nothing at all, because it is almost every prompt", () => {
    expect(say(standing({ where: { lost: LOST, onDisk: true } }))).toBe("");
  });
});

describe("no destination", () => {
  test("a repository with no worktree on main holds the session rather than guessing a path", () => {
    const s = standing({ main: { kind: "absent", why: "git reported no worktree on main" } });
    expect(home(s)).toEqual({ kind: "held" });
  });

  test("held says where the session was, that it did not move, and what it left", () => {
    const s = standing({ main: { kind: "absent", why: "git reported no worktree on main" } });
    expect(say(s)).toBe(
      "This session was working in /Users/x/dev/spectre-worktrees/fix-login, which no longer exists, and this repository has no worktree on main, so there was nowhere to move to. The session was not moved. Branch fix-login is on main.",
    );
  });

  test("held says so plainly when the branch cannot be named at all", () => {
    const s = standing({
      main: { kind: "absent", why: "git reported no worktree on main" },
      branch: { kind: "unrecoverable", why: "no row and no ref" },
    });
    expect(say(s)).toContain("The branch it held could not be identified");
  });
});

describe("moving home", () => {
  test("landed work on a current clean main is the clean return", () => {
    expect(home(standing())).toEqual({ kind: "went-home" });
  });

  test("the line names the directory it moved to and the branch that landed", () => {
    expect(say(standing())).toBe(
      "This session was working in /Users/x/dev/spectre-worktrees/fix-login, which no longer exists. It moved to /Users/x/dev/spectre. Branch fix-login is on main.",
    );
  });

  test("a branch git could not name is reported as unidentifiable, not guessed at", () => {
    const s = standing({ branch: { kind: "unrecoverable", why: "no row and no ref" } });
    expect(say(s)).toContain("could not be identified");
  });
});

describe("moving home, caught short", () => {
  test("work that is not on main still moves, and says the work is not here", () => {
    expect(home(standing({ landing: { kind: "not-on-main", since: 4 } }))).toEqual({
      kind: "went-home-caught-short",
    });
    expect(say(standing({ landing: { kind: "not-on-main", since: 4 } }))).toContain(
      "4 commits on it are not in main",
    );
  });

  test("a dirty main is named with its tracked-change count and updating is left to the caller", () => {
    const s = standing({ main: { kind: "found", directory: MAIN, dirty: { kind: "wip", count: 2 } } });
    const line = say(s);
    expect(line).toContain("main has 2 tracked changes");
    expect(line).toContain("Updating main is your call");
  });

  test("a main behind origin reports the distance rather than fetching", () => {
    const s = standing({ behind: 7 });
    expect(say(s)).toContain("main is 7 commits behind origin/main");
  });

  test("unknown origin/main is not reported as a distance", () => {
    // `behind: undefined` means the ref is unknown, a different fact from 0, and the
    // sentence must not invent a number for it.
    expect(say(standing({ behind: undefined }))).not.toContain("commits behind");
    expect(say(standing({ behind: 3 }))).toContain(
      "main is 3 commits behind origin/main",
    );
  });

  test("unprovable landing is stated as unprovable, with the reason", () => {
    const s = standing({ landing: { kind: "unknown", why: "origin/main is not fetched" } });
    expect(say(s)).toContain("could not be established: origin/main is not fetched");
  });
});

describe("dirty and behind at once", () => {
  test("a dirty main that is also behind names both reasons in the one sentence", () => {
    const s = standing({
      main: { kind: "found", directory: MAIN, dirty: { kind: "wip", count: 2 } },
      behind: 7,
    });
    expect(home(s)).toEqual({ kind: "went-home-caught-short" });
    const line = say(s);
    expect(line).toContain("main has 2 tracked changes");
    expect(line).toContain("main is 7 commits behind origin/main");
  });
});

describe("no destination, but a nameable branch", () => {
  test("held still names the branch and whether its work landed", () => {
    // Nowhere to move to is not a reason to withhold what the session needs to
    // know: a named branch is the difference between work it can go and get and
    // work it cannot.
    const s = standing({
      main: { kind: "absent", why: "git reported no worktree on main" },
      branch: { kind: "named-by-git", name: "fix-login" },
      landing: { kind: "on-main", by: "ancestor" },
    });
    expect(home(s)).toEqual({ kind: "held" });
    const line = say(s);
    expect(line).toBe(
      "This session was working in /Users/x/dev/spectre-worktrees/fix-login, which no longer exists, and this repository has no worktree on main, so there was nowhere to move to. The session was not moved. Branch fix-login is on main.",
    );
  });

  test("held says the work is NOT there when it is not", () => {
    const s = standing({
      main: { kind: "absent", why: "git reported no worktree on main" },
      branch: { kind: "named-by-git", name: "fix-login" },
      landing: { kind: "not-on-main", since: 4 },
    });
    expect(say(s)).toContain("4 commits on it are not in main");
  });
});
