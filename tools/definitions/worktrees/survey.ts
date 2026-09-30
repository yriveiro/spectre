import {
  BUCKETS,
  type Bucket,
  bucket,
  count,
  dirtyOf,
  prFor,
  trackedChanges,
  trackedOf,
  type Tracked,
} from "./classify";
import {
  answered,
  git as run,
  listed,
  mainOf,
  type PullRequest,
  pullRequests,
} from "./read";

export type Row = {
  readonly path: string;
  readonly branch: string;
  readonly head: string;
  readonly ageDays: number;
  readonly merged: boolean | "unknown";
  readonly dirty: string;
  readonly remote: string;
  readonly pr: string;
  readonly bucket: Bucket;
};

export type Report = {
  readonly worktrees: ReadonlyArray<Row>;
  readonly problems: ReadonlyArray<string>;
};



const kindOfPushed = (where: string): boolean | "unknown" => {
  if (where === "no-remote") return false;
  if (where === "unknown" || where === "detached") return "unknown";
  return true;
};

const remote = async (cwd: string, branch: string, head: string): Promise<string> => {
  if (branch === "") return "detached";
  const exists = await run(cwd, ["show-ref", "--verify", "--quiet", `refs/remotes/origin/${branch}`]);
  if (!exists.ran) return "unknown";
  if (exists.code !== 0) return "no-remote";
  const tip = await run(cwd, ["rev-parse", `origin/${branch}`]);
  if (tip.ran && tip.out === head) return "pushed";
  const ahead = await run(cwd, ["rev-list", "--count", `origin/${branch}..HEAD`]);
  if (!ahead.ran) return "unknown";
  const n = Number(ahead.out);
  return Number.isFinite(n) ? `ahead:${n}` : "unknown";
};

/**
 * `git cherry` matches per-commit patch-ids, so a one-commit squash or a cherry-pick
 * reads `landed` while an N-into-1 squash reads `unlanded` — measured, not assumed.
 */
const landing = async (main: string, branch: string, head: string) => {
  const ancestor = await run(main, ["merge-base", "--is-ancestor", `${head}^{commit}`, "origin/main"]);
  if (answered(ancestor)) return { merged: true, patches: "landed" } as const;

  const cherry = await run(main, ["cherry", "origin/main", branch]);
  if (!cherry.ran || cherry.code !== 0)
    return { merged: ancestor.ran ? (false as const) : ("unknown" as const), patches: "unknown" } as const;
  if (cherry.out === "") return { merged: false, patches: "landed" } as const;
  return { merged: false, patches: "unlanded" } as const;
};

/**
 * No `git fetch` and no `du`. Fetching writes to the network from a tool declared
 * `read`, and disk size orders a cleanup rather than deciding one. The consequence is
 * that `origin/main` may be stale, which `problems` names rather than reporting nothing
 * merged.
 *
 * No `gh` in the decision: the buckets are decided with the git CLI. `gh` is read for
 * pull-request state to display, and a failure there degrades the `pr` column only.
 */
export const audit = async (directory: string): Promise<Report> => {
  const problems: Array<string> = [];

  const listing = await listed(directory);
  if (listing.kind === "no-repository")
    return { worktrees: [], problems: [`${directory} is not a git repository`] };

  // A bare repository is listed FIRST and carries neither a HEAD nor a branch, so
  // position is not the answer: the worktree on `main` is main, and a bare entry is
  // none of them.
  const main = mainOf(listing.rows);
  if (main === undefined)
    return { worktrees: [], problems: [`git reported no worktree on main in ${directory}`] };

  const rest = listing.rows.filter((one) => one.bare !== true && one.branch !== "main");

  const hasBase = answered(await run(directory, ["rev-parse", "--verify", "--quiet", "refs/remotes/origin/main"]));
  if (!hasBase)
    problems.push(
      "origin/main is not fetched, so `merged` is false everywhere; fetch it before trusting `safe`",
    );

  const prs = await pullRequests(directory);
  if (!prs.ok)
    problems.push(
      `${prs.reason}, so the \`pr\` column reads as no pull request; the buckets do not depend on it`,
    );
  const pulled: ReadonlyArray<PullRequest> = prs.ok ? prs.prs : [];

  const now = Date.now();

  const worktrees = await Promise.all(
    rest.map(async (one): Promise<Row | undefined> => {
      const head = one.head ?? "";
      const stamped = await run(one.directory, ["log", "-1", "--format=%ct", "HEAD"]);

      // git still lists a collected worktree as a `prunable` row carrying its branch
      // and HEAD. There is no tree to measure, so a row built from it would report
      // `clean` about a directory that does not exist.
      if (!answered(stamped)) {
        problems.push(
          `${one.directory} is listed by git but its directory is gone; run \`git worktree prune\` to clear the row`,
        );
        return undefined;
      }

      const at = Number(stamped.out);
      const status = await run(one.directory, ["status", "--porcelain"]);
      const spread = await landing(main, one.branch ?? "", head);
      const where = await remote(one.directory, one.branch ?? "", head);

      const dirty: Tracked = answered(status) ? trackedOf(trackedChanges(status.out)) : { kind: "unknown" };
      const evidence = {
        dirty,
        merged: spread.merged,
        patches: spread.patches,
        pushed: kindOfPushed(where),
      };

      return {
        path: one.directory,
        branch: one.branch ?? "",
        head,
        ageDays: Number.isFinite(at) && at > 0 ? Math.floor((now - at * 1000) / 86_400_000) : -1,
        merged: spread.merged,
        dirty: dirtyOf(dirty),
        remote: where,
        pr: prFor(one.branch ?? "", pulled),
        bucket: bucket(evidence),
      };
    }),
  );

  return { worktrees: worktrees.filter((one): one is Row => one !== undefined), problems };
};

export { BUCKETS, count };
