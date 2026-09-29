import { type Bucket, bucket, type Evidence, prFor, type PullRequest } from "./classify";

export type Row = Evidence & {
  readonly path: string;
  readonly branch: string;
  readonly head: string;
  readonly ageDays: number;
  readonly remote: string;
  readonly bucket: Bucket;
};

export type Report = { readonly worktrees: ReadonlyArray<Row>; readonly problems: ReadonlyArray<string> };

type Head = { readonly path: string; readonly head: string; readonly branch: string };

const run = async (
  cwd: string,
  args: ReadonlyArray<string>,
): Promise<{ out: string; err: string; code: number }> => {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { out: out.trim(), err: err.trim(), code };
};

const heads = (porcelain: string): ReadonlyArray<Head> => {
  const found: Array<Head> = [];
  let path = "";
  let head = "";
  let branch = "";

  const flush = () => {
    if (path !== "") found.push({ path, head, branch });
    path = "";
    head = "";
    branch = "";
  };

  for (const line of porcelain.split("\n")) {
    if (line === "") {
      flush();
      continue;
    }
    if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
    else if (line.startsWith("HEAD ")) head = line.slice("HEAD ".length);
    else if (line.startsWith("branch "))
      // Porcelain names the branch in full; every lookup below wants the short
      // name, the same one `git symbolic-ref --short` and `gh` report.
      branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
  }
  flush();

  return found;
};

const dirty = (porcelain: string): string => {
  if (porcelain === "") return "clean";
  const lines = porcelain.split("\n");
  const tracked = lines.filter((line) => !line.startsWith("??")).length;
  if (tracked > 0) return `wip:${tracked}`;
  return `scratch:${lines.length}`;
};

const remote = async (cwd: string, branch: string, head: string): Promise<string> => {
  if (branch === "") return "detached";
  const exists = await run(cwd, ["show-ref", "--verify", "--quiet", `refs/remotes/origin/${branch}`]);
  if (exists.code !== 0) return "no-remote";
  const tip = await run(cwd, ["rev-parse", `origin/${branch}`]);
  if (tip.out === head) return "pushed";
  const count = await run(cwd, ["rev-list", "--count", `origin/${branch}..HEAD`]);
  return `ahead:${Number(count.out) || 0}`;
};

type Pr = PullRequest;

type Prs =
  | { readonly ok: true; readonly prs: ReadonlyArray<Pr> }
  | { readonly ok: false; readonly reason: string };

/**
 * `gh` needs a remote to resolve a repository, so its ways of failing are
 * different facts. Collapsing them into one message sends the reader after the
 * wrong problem: an unauthenticated `gh` and a repository with no remote look
 * identical from outside and need opposite fixes.
 */
const pullRequests = async (cwd: string): Promise<Prs> => {
  if (Bun.which("gh") === null) return { ok: false, reason: "`gh` is not on PATH" };

  const proc = Bun.spawn(
    ["gh", "pr", "list", "--author", "@me", "--state", "all", "--limit", "1000", "--json", "number,state,headRefName"],
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

  return { ok: true, prs: parsed as ReadonlyArray<Pr> };
};

/**
 * No `git fetch` and no `du`. Fetching writes to the network from a tool
 * declared `read`, and disk size is not a deletion-safety input: it orders a
 * cleanup, it does not decide one. Both were in the shell this replaces.
 */
export const audit = async (directory: string): Promise<Report> => {
  const problems: Array<string> = [];

  const listed = await run(directory, ["worktree", "list", "--porcelain"]);
  if (listed.code !== 0)
    return { worktrees: [], problems: [`${directory} is not a git repository`] };

  const all = heads(listed.out);
  const [main, ...rest] = all;
  if (main === undefined) return { worktrees: [], problems: [`git reported no worktree in ${directory}`] };

  const base = await run(directory, ["rev-parse", "--verify", "--quiet", "refs/remotes/origin/main"]);
  const hasBase = base.code === 0;
  if (!hasBase)
    problems.push(
      "origin/main is not fetched, so `merged` is false everywhere; fetch it before trusting `safe`",
    );

  const prs = await pullRequests(directory);
  if (!prs.ok)
    problems.push(
      `${prs.reason}, so every branch reads as having no PR and a \`safe\` row rests on the merge column alone`,
    );

  const now = Date.now();
  const worktrees: Array<Row> = [];

  for (const one of rest) {
    const stamped = await run(one.path, ["log", "-1", "--format=%ct", "HEAD"]);
    const at = Number(stamped.out);
    const ancestor = hasBase
      ? await run(directory, ["merge-base", "--is-ancestor", one.head, "refs/remotes/origin/main"])
      : { code: 1, out: "", err: "" };

    const evidence: Evidence = {
      merged: ancestor.code === 0,
      dirty: dirty((await run(one.path, ["status", "--porcelain"])).out),
      pr: prFor(one.branch, prs.ok ? prs.prs : []),
    };

    worktrees.push({
      ...evidence,
      path: one.path,
      branch: one.branch,
      head: one.head,
      ageDays: Number.isFinite(at) && at > 0 ? Math.floor((now - at * 1000) / 86_400_000) : -1,
      remote: await remote(one.path, one.branch, one.head),
      bucket: bucket(evidence),
    });
  }

  return { worktrees, problems };
};
