import { basename, dirname, join } from "node:path";
import { AbsolutePath } from "@opencode/schema/schema";
import { Worktree } from "@opencode/schema/worktree";
import { Effect, Schema } from "effect";

export type Result =
  | { readonly ran: true; readonly out: string; readonly err: string; readonly code: number }
  | { readonly ran: false; readonly err: string };

/**
 * `Bun.spawn` throws `ENOENT` from `posix_spawn` for a `cwd` that is not there, rather
 * than exiting non-zero. Measured on Bun 1.4.2. A collected worktree is a state this
 * tool exists to reason about, so it is an answer here and not an exception.
 */
export const git = async (cwd: string, args: ReadonlyArray<string>): Promise<Result> => {
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

/**
 * A command that ran and failed is not a command that answered. `git status` on an
 * unreadable worktree exits 128 with an empty stdout, which is the exact shape of a
 * clean tree. Exported because three modules need it and one copy of a safety property
 * is a property.
 */
export const answered = (result: Result): result is Extract<Result, { readonly ran: true }> =>
  result.ran && result.code === 0;

const Listed = Schema.Struct({
  directory: Schema.String,
  branch: Schema.optional(Schema.String),
  head: Schema.optional(Schema.String),
  bare: Schema.optional(Schema.Boolean),
});

export type ListedWorktree = typeof Listed.Type;

const parse = (porcelain: string): ReadonlyArray<ListedWorktree> => {
  const found: Array<{ directory: string; branch?: string; head?: string; bare?: boolean }> = [];
  let current: { directory: string; branch?: string; head?: string; bare?: boolean } | undefined;
  let head = "";

  const flush = () => {
    if (current !== undefined) found.push({ ...current, head: head === "" ? undefined : head });
    current = undefined;
    head = "";
  };

  for (const line of porcelain.split("\n")) {
    if (line === "") {
      flush();
      continue;
    }
    if (line.startsWith("worktree ")) {
      flush();
      current = { directory: line.slice("worktree ".length).trim() };
    } else if (current === undefined) continue;
    else if (line.startsWith("HEAD ")) head = line.slice("HEAD ".length).trim();
    else if (line === "bare") current.bare = true;
    else if (line.startsWith("branch refs/heads/"))
      current.branch = line.slice("branch refs/heads/".length).trim();
  }
  flush();

  return Schema.decodeUnknownSync(Schema.Array(Listed))(found);
};

export type Listing =
  | { readonly kind: "listed"; readonly rows: ReadonlyArray<ListedWorktree> }
  | { readonly kind: "no-repository"; readonly why: string };

export const listed = async (cwd: string): Promise<Listing> => {
  const result = await git(cwd, ["worktree", "list", "--porcelain"]);
  if (!result.ran) return { kind: "no-repository", why: result.err };
  if (result.code !== 0)
    return { kind: "no-repository", why: result.err || `git worktree list exited ${result.code}` };
  return { kind: "listed", rows: parse(result.out) };
};

export const mainOf = (rows: ReadonlyArray<ListedWorktree>) =>
  rows.find((one) => one.branch === "main")?.directory;

export const bareOf = (rows: ReadonlyArray<ListedWorktree>) =>
  rows.find((one) => one.bare === true)?.directory;

export const toplevel = async (directory: string): Promise<string | undefined> => {
  const result = await git(directory, ["rev-parse", "--path-format=absolute", "--show-toplevel"]);
  return answered(result) && result.out !== "" ? result.out : undefined;
};

export const rootFor = (repository: string): AbsolutePath => {
  const base = basename(repository) || "project";
  return AbsolutePath.make(join(dirname(repository), `${base}-worktrees`));
};

export const branchExists = async (cwd: string, branch: string): Promise<boolean> =>
  answered(await git(cwd, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]));

export const resolves = async (cwd: string, ref: string): Promise<boolean> =>
  answered(await git(cwd, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]));

export const firstResolving = async (cwd: string, candidates: ReadonlyArray<string>) => {
  for (const one of candidates) if (await resolves(cwd, one)) return one;
  return undefined;
};

/**
 * Both are sums rather than `string | undefined`, because a git that ran and failed
 * prints its argument back: `rev-parse HEAD` in a repository with no commits exits 128
 * and prints `HEAD` on stdout, which is indistinguishable from a detached HEAD and
 * from a commit that happens to be named `HEAD`. Measured on this machine.
 */
export type Rev =
  | { readonly kind: "read"; readonly value: string }
  | { readonly kind: "unreadable"; readonly why: string };

const rev = async (cwd: string, args: ReadonlyArray<string>): Promise<Rev> => {
  const result = await git(cwd, args);
  if (!result.ran) return { kind: "unreadable", why: result.err };
  if (result.code === 0) return { kind: "read", value: result.out };
  return { kind: "unreadable", why: result.err || `git exited ${result.code}` };
};

export const head = (cwd: string): Promise<Rev> => rev(cwd, ["rev-parse", "HEAD"]);

/**
 * The commit a ref names. A worktree is cut from `base`, so `base` is what its
 * head has to equal. Reading the calling checkout's HEAD instead reports a
 * mismatch for every worktree cut anywhere but HEAD.
 */
export const commitOf = (cwd: string, ref: string): Promise<Rev> => rev(cwd, ["rev-parse", ref]);

export const currentBranch = (cwd: string): Promise<Rev> =>
  rev(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);

/**
 * The branch a ref names, in the one spelling a consumer will accept.
 *
 * `rev-parse --symbolic-full-name` follows a symbolic ref to the branch behind
 * it, so `origin/HEAD` answers `refs/remotes/origin/main`. That indirection is
 * the point: OpenCode's review-base lookup refuses a creation hint naming
 * `HEAD` or anything ending in `/HEAD`, and a worktree cut from `origin/HEAD`
 * is exactly the case that produces the spelling it refuses.
 *
 * A ref that does not resolve exits 128 with empty stdout, the same shape as a
 * clean answer, so this answers nothing rather than forwarding it.
 */
export const concreteRef = async (cwd: string, ref: string) => {
  const got = await git(cwd, ["rev-parse", "--symbolic-full-name", "--verify", "--end-of-options", ref]);
  if (!answered(got)) return undefined;
  const name = got.out.trim();
  return /^refs\/(heads|remotes)\/.+/.test(name) ? name : undefined;
};

/**
 * The one mutating git command the host does not provide: its create runs
 * `git worktree add --detach` (`packages/core/src/git.ts` at v2.0.29) and carries no
 * branch, so a worktree on a branch is two steps and this is the second.
 *
 * `from` is the base the worktree was cut from, and it becomes the start point
 * so the new branch's reflog names it. Switching off the detached HEAD with no
 * start point records `branch: Created from HEAD`, and `HEAD` names no branch:
 * the review-base lookup rejects that hint, falls through to the default
 * branch, and only answers there when the worktree is itself on the default
 * branch. Every worktree this tool opens is on its own branch, so the base is
 * unrecoverable and the diff viewer asks for one on every open.
 *
 * A base that does not resolve to a branch is not worth failing over, so this
 * falls back to switching off HEAD and the worktree is created exactly as
 * before. What is lost is the reflog provenance, not the worktree.
 */
export const attachBranch = async (cwd: string, branch: string, from?: string) => {
  const start = from === undefined ? undefined : await concreteRef(cwd, from);
  return git(cwd, start === undefined ? ["switch", "-c", branch] : ["switch", "-c", branch, start]);
};

/**
 * The second step when the branch is already there. `-c` would fail with "branch
 * already exists", so this drops the flag: the worktree lands detached either way, and
 * both of these are what put a name on it.
 */
export const takeBranch = (cwd: string, branch: string) => git(cwd, ["switch", branch]);

export const isWorktree = async (directory: string): Promise<boolean> =>
  answered(await git(directory, ["rev-parse", "--git-dir"]));

export type PullRequest = {
  readonly number: number;
  readonly state: string;
  readonly headRefName: string;
};

export type PullRequests =
  | { readonly ok: true; readonly prs: ReadonlyArray<PullRequest> }
  | { readonly ok: false; readonly reason: string };

/**
 * `gh` needs a remote to resolve a repository, so its ways of failing are different
 * facts. Collapsing them sends the reader after the wrong problem: an unauthenticated
 * `gh` and a repository with no remote look identical from outside.
 */
export const pullRequests = async (cwd: string): Promise<PullRequests> => {
  if (Bun.which("gh") === null) return { ok: false, reason: "`gh` is not on PATH" };

  const proc = Bun.spawn(
    [
      "gh",
      "pr",
      "list",
      "--author",
      "@me",
      "--state",
      "all",
      "--limit",
      "1000",
      "--json",
      "number,state,headRefName",
    ],
    { cwd, stdout: "pipe", stderr: "pipe" },
  );
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (code !== 0) {
    const first = err.split("\n").find((line) => line.trim() !== "");
    return {
      ok: false,
      reason: `\`gh pr list\` failed: ${first === undefined ? `exit ${code}, no message` : first.trim()}`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(out === "" ? "[]" : out);
  } catch {
    return { ok: false, reason: "`gh pr list` returned output that is not JSON" };
  }
  if (!Array.isArray(parsed))
    return { ok: false, reason: "`gh pr list` returned JSON that is not a list" };

  return { ok: true, prs: parsed as ReadonlyArray<PullRequest> };
};

/**
 * `Worktree.OperationError` carries `forceRequired`, which the host computes by
 * matching git's own refusal text (`packages/core/src/git.ts` at v2.0.29). A boolean
 * that names the guard is worth more than a stringified unknown.
 */
export const hostRefusal = (cause: unknown): { message: string; forceRequired: boolean } => {
  const decoded = Schema.decodeUnknownOption(Schema.Struct({ message: Schema.String }))(cause);
  if (decoded._tag === "None") return { message: String(cause), forceRequired: false };
  const forced = (cause as { readonly forceRequired?: unknown }).forceRequired === true;
  return { message: decoded.value.message, forceRequired: forced };
};

export { Effect, Worktree };
