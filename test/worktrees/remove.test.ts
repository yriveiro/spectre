import { afterAll, describe, expect, test } from "bun:test";
import type { Plugin } from "@opencode/plugin/effect";
import type { Tool } from "@opencode/schema/tool";
import { AbsolutePath } from "@opencode/schema/schema";
import { Effect } from "effect";
import { worktrees } from "../../tools/definitions/worktrees";
import { isDirectory } from "../../tools/definitions/worktrees/return/standing";

const TMP = Bun.env.TMPDIR ?? "/tmp";
const roots: Array<string> = [];
let seq = 0;

const context = { progress: () => Effect.void } as unknown as Tool.Context;

const git = async (cwd: string, args: ReadonlyArray<string>) => {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { out: out.trim(), err: err.trim(), code };
};

/**
 * This project's own shape: a bare repository, `main` cut from it, and one feature
 * worktree beside. Two sessions' worth of directories, because the question this file
 * asks is what happens to the caller when the directory it is standing in goes away.
 */
const layout = async () => {
  const base = `${TMP}/spectre-remove-${process.pid}-${seq++}`;
  roots.push(base);
  const bare = `${base}/spectre`;
  const main = `${base}/spectre-worktrees/main`;
  const other = `${base}/spectre-worktrees/other`;

  await Bun.write(`${base}/.keep`, "");
  await git(base, ["init", "-q", "--bare", bare]);
  await git(base, ["clone", "-q", bare, `${base}/seed`]);
  await Bun.write(`${base}/seed/a.txt`, "one\n");
  await git(`${base}/seed`, ["add", "."]);
  await git(`${base}/seed`, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "first"]);
  await git(`${base}/seed`, ["push", "-q", bare, "HEAD:refs/heads/main"]);
  await git(bare, ["worktree", "add", "-q", main, "main"]);
  await git(bare, ["worktree", "add", "-q", "-b", "fix-login", other]);
  await Bun.$`rm -rf ${`${base}/seed`}`.quiet();

  // Git's spelling, not the shell's. On macOS TMPDIR is `/var/...` with a trailing
  // slash and git reports `/private/var/...`, and the tool compares the directory it is
  // given against the paths git prints, so a fixture that mixes the two would be
  // testing the comparison instead of the bug.
  return { bare, main: await toplevel(main), other: await toplevel(other) };
};

/**
 * The host's remove as v2.0.20 shapes it (`packages/core/src/worktree.ts` delegating to
 * `packages/core/src/git.ts`): `git worktree remove` is spawned with the repository's
 * common directory as its cwd, so the removal itself works whatever the caller's cwd
 * is. That is why this test needs a tool-side fix and not a git workaround.
 *
 * The session is a location, not a call log, so the assertions below can be about where
 * the session ended up rather than about which methods were invoked.
 */
/** git's own spelling of a worktree's top level, which is not the spelling TMPDIR hands out. */
const toplevel = async (path: string) => {
  const found = await git(path, ["rev-parse", "--path-format=absolute", "--show-toplevel"]);
  return found.out;
};

const host = (projectRow: string, sessionDirectory: string) => {
  const session = { where: sessionDirectory };

  return {
    session,
    context: () =>
      ({
        location: {
          project: { id: "test", directory: AbsolutePath.make(projectRow) },
          location: { directory: AbsolutePath.make(session.where) },
        },
        session: {
          get: () => Effect.succeed({ location: { directory: session.where } }),
          move: ({ directory }: { directory: string }) =>
            Effect.sync(() => {
              session.where = directory;
              return {};
            }),
        },
        worktree: {
          remove: ({ directory, force }: { directory: string; force: boolean }) =>
            Effect.promise(async () =>
              git(projectRow, ["worktree", "remove", ...(force ? ["--force"] : []), directory]),
            ).pipe(
              Effect.flatMap((done) =>
                done.code === 0
                  ? Effect.void
                  : Effect.fail({
                      _tag: "Worktree.OperationError",
                      message: done.err || `exit ${done.code}`,
                    }),
              ),
            ),
        },
      }) as unknown as Plugin.Context,
  };
};

type Outcome =
  | { readonly status: "removed"; readonly directory: string; readonly branch?: string }
  | { readonly status: "already-gone" | "rejected" | "failed" | "unverified" | "opened"; readonly problems: string };

const remove = async (fake: ReturnType<typeof host>, directory: string) => {
  const result = await Effect.runPromise(
    worktrees(fake.context()).execute({ action: "remove", directory }, { ...context, sessionID: "test" as never }),
  );
  return result.output as Outcome;
};

afterAll(async () => {
  for (const one of roots) await Bun.$`rm -rf ${one}`.quiet();
});

describe("removing the worktree the session is standing in", () => {
  test("the session ends up in the main worktree, not in the directory that was deleted", async () => {
    const { bare, main, other } = await layout();
    const fake = host(bare, other);

    const outcome = await remove(fake, other);

    expect(outcome.status).toBe("removed");
    // Asserted as the session's location rather than as a recorded call: the defect is
    // that `removed` used to leave the caller pointing at a directory with no inode.
    expect(fake.session.where).toBe(main);
    // The place it landed has to be a place. A session moved onto a path that is not
    // there has been moved nowhere.
    expect(await isDirectory(fake.session.where)).toBe(true);
  });

  test("the directory is gone either way, so the move is not a way of keeping it", async () => {
    const { bare, other } = await layout();
    const fake = host(bare, other);

    const outcome = await remove(fake, other);

    expect(outcome.status).toBe("removed");
    expect(await isDirectory(other)).toBe(false);
  });

  test("removing somebody else's worktree leaves the session where it was", async () => {
    const { bare, main, other } = await layout();
    const fake = host(bare, main);

    const outcome = await remove(fake, other);

    // The over-reach this guards: a `remove` that drags the caller home even when the
    // caller is not in the way costs the caller its working directory for nothing.
    expect(outcome.status).toBe("removed");
    expect(fake.session.where).toBe(main);
  });
});