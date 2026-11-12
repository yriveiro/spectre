import type { Place } from "./contract";

/**
 * What git can say about the session's place, in the order that matters:
 * a working tree, a linked worktree, a branch that is not the trunk, and a
 * branch rather than a detached HEAD.
 *
 * `worktrees/read.ts` has a parser for `git worktree list`, and this module does
 * not import it. A second definition reaching into another definition's
 * internals is the boundary signal, not a convenience. Three `rev-parse` calls
 * answer this question on their own.
 */

type Git =
  | { readonly ran: true; readonly out: string; readonly err: string; readonly code: number }
  | { readonly ran: false; readonly err: string };

/**
 * `Bun.spawn` throws `ENOENT` from `posix_spawn` for a `cwd` that is not there,
 * rather than exiting non-zero. A collected directory is an answer here, not an
 * exception.
 */
const git = async (cwd: string, args: ReadonlyArray<string>): Promise<Git> => {
  let proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
  try {
    proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  } catch (cause) {
    const why = cause instanceof Error ? cause.message : String(cause);
    return { ran: false, err: `${cwd}: ${why}` };
  }
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { ran: true, out: out.trim(), err: err.trim(), code };
};

const why = (result: Git, fallback: string): string =>
  result.ran ? result.err || `${fallback} exited ${result.code}` : result.err;

/**
 * The trunk name, from `origin/HEAD` when it resolves, else `main`.
 *
 * A linked worktree checked out on the trunk is a working directory the rule
 * must refuse, and this repository's normal checkout is exactly that: a linked
 * worktree on `main` under `spectre-worktrees/`. Reading only
 * `--git-dir !== --git-common-dir` would accept it.
 */
const trunk = async (directory: string): Promise<string> => {
  const head = await git(directory, [
    "symbolic-ref",
    "--quiet",
    "--short",
    "refs/remotes/origin/HEAD",
  ]);
  if (head.ran && head.code === 0 && head.out.startsWith("origin/"))
    return head.out.slice("origin/".length);
  return "main";
};

export const place = async (directory: string): Promise<Place> => {
  const top = await git(directory, ["rev-parse", "--path-format=absolute", "--show-toplevel"]);
  if (!top.ran || top.code !== 0 || top.out === "")
    return {
      kind: "not-a-repository",
      directory,
      why: why(top, "git rev-parse --show-toplevel"),
    };

  const root = top.out;
  const dirs = await git(root, [
    "rev-parse",
    "--path-format=absolute",
    "--git-dir",
    "--git-common-dir",
  ]);
  if (!dirs.ran || dirs.code !== 0)
    return { kind: "not-a-repository", directory: root, why: why(dirs, "git rev-parse --git-dir") };

  const [gitDir, commonDir] = dirs.out.split("\n").map((line) => line.trim());
  if (gitDir === undefined || commonDir === undefined || gitDir === "" || commonDir === "")
    return {
      kind: "not-a-repository",
      directory: root,
      why: "git did not report both the git directory and the common directory",
    };

  // The main working tree of an ordinary repository: one directory, and no
  // linked worktree to move the session into. A goal armed here is the branch
  // in the checkout being edited, which the rule forbids.
  if (gitDir === commonDir) return { kind: "main-worktree", directory: root };

  const branch = await git(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!branch.ran || branch.code !== 0)
    return {
      kind: "not-a-repository",
      directory: root,
      why: why(branch, "git rev-parse --abbrev-ref HEAD"),
    };

  const name = branch.out.trim();
  if (name === "" || name === "HEAD") return { kind: "detached", directory: root };
  if (name === (await trunk(root))) return { kind: "main-branch", directory: root, branch: name };
  return { kind: "feature", directory: root, branch: name };
};
