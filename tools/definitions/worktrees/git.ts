import { basename, dirname, join } from "node:path";
import { AbsolutePath } from "@opencode/schema/schema";
import { Worktree } from "@opencode/schema/worktree";
import { Effect, Schema } from "effect";

type Result = { out: string; err: string; code: number };

export const git = async (cwd: string, args: ReadonlyArray<string>): Promise<Result> => {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { out: out.trim(), err: err.trim(), code };
};

const Listed = Schema.Struct({
  directory: Schema.String,
  branch: Schema.optional(Schema.String),
  bare: Schema.optional(Schema.Boolean),
});

export type ListedWorktree = typeof Listed.Type;

const parse = (out: string): ReadonlyArray<ListedWorktree> => {
  const found: Array<{ directory: string; branch?: string; bare?: boolean }> = [];
  let current: { directory: string; branch?: string; bare?: boolean } | undefined;

  for (const line of out.split("\n")) {
    if (line === "") {
      if (current !== undefined) found.push(current);
      current = undefined;
      continue;
    }
    if (line.startsWith("worktree ")) current = { directory: line.slice("worktree ".length).trim() };
    else if (current === undefined) continue;
    else if (line === "bare") current.bare = true;
    else if (line.startsWith("branch refs/heads/"))
      current.branch = line.slice("branch refs/heads/".length).trim();
  }
  if (current !== undefined) found.push(current);

  return Schema.decodeUnknownSync(Schema.Array(Listed))(found);
};

export const listed = async (cwd: string): Promise<ReadonlyArray<ListedWorktree>> =>
  parse((await git(cwd, ["worktree", "list", "--porcelain"])).out);

export const mainOf = (rows: ReadonlyArray<ListedWorktree>) =>
  rows.find((one) => one.branch === "main")?.directory;

export const bareOf = (rows: ReadonlyArray<ListedWorktree>) =>
  rows.find((one) => one.bare === true)?.directory;

export const toplevel = async (directory: string): Promise<string | undefined> => {
  const { out, code } = await git(directory, [
    "rev-parse",
    "--path-format=absolute",
    "--show-toplevel",
  ]);
  return code === 0 && out !== "" ? out : undefined;
};

export const takenBy = (rows: ReadonlyArray<ListedWorktree>, directory: string) =>
  rows.some((one) => one.directory === directory);

export const rootFor = (repository: string): AbsolutePath => {
  const base = repository.split("/").filter((part) => part !== "").pop() ?? "project";
  return AbsolutePath.make(join(dirname(repository), `${base}-worktrees`));
};

export const branchExists = async (cwd: string, branch: string): Promise<boolean> =>
  (await git(cwd, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`])).code === 0;

export const resolves = async (cwd: string, ref: string): Promise<boolean> =>
  (await git(cwd, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`])).code === 0;

export const firstResolving = async (cwd: string, candidates: ReadonlyArray<string>) => {
  for (const one of candidates) if (await resolves(cwd, one)) return one;
  return undefined;
};

export const head = async (cwd: string): Promise<string> => (await git(cwd, ["rev-parse", "HEAD"])).out;

export const currentBranch = async (cwd: string): Promise<string> =>
  (await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"])).out;

/**
 * The one mutating git command the host does not provide. Its create runs
 * `git worktree add --detach` (`packages/core/src/git.ts` at v2.0.19) and
 * `Worktree.Info` is `{directory}` with no branch, so a worktree that is on a
 * branch is two steps and this is the second.
 */
export const attachBranch = (cwd: string, branch: string) => git(cwd, ["switch", "-c", branch]);

export const isWorktree = async (directory: string): Promise<boolean> =>
  (await git(directory, ["rev-parse", "--git-dir"])).code === 0;

/**
 * `Worktree.OperationError` carries `forceRequired`, which the host computes by
 * matching git's own refusal text (`packages/core/src/git.ts` at v2.0.19). A
 * boolean that names the guard is worth more than a stringified unknown, so the
 * failure is decoded into it rather than interpolated.
 */
export const refusal = (cause: unknown): { message: string; forceRequired: boolean } => {
  const decoded = Schema.decodeUnknownOption(Schema.Struct({ message: Schema.String }))(cause);
  if (decoded._tag === "None") return { message: String(cause), forceRequired: false };
  const forced = (cause as { readonly forceRequired?: unknown }).forceRequired === true;
  return { message: decoded.value.message, forceRequired: forced };
};

export { Worktree };
