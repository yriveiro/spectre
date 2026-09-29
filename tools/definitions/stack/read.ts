import { type Ci, type Snapshot } from "./classify";

const FIELDS =
  "number,state,isDraft,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,mergedAt";

type Rollup = {
  readonly status?: string | null;
  readonly conclusion?: string | null;
};

type Facts = {
  readonly number: number;
  readonly state: string;
  readonly isDraft: boolean;
  readonly mergeable: string;
  readonly mergeStateStatus: string;
  readonly reviewDecision: string | null;
  readonly statusCheckRollup: ReadonlyArray<Rollup>;
  readonly mergedAt: string | null;
};

const FAILING = new Set([
  "FAILURE",
  "TIMED_OUT",
  "CANCELLED",
  "ACTION_REQUIRED",
  "STARTUP_FAILURE",
]);

/**
 * `github-rejected` is CI failing while the merge is BLOCKED, which is a
 * different act from CI merely failing: GitHub is refusing the merge, so
 * waiting or re-running will not clear it.
 */
const ci = (rollup: ReadonlyArray<Rollup>, mergeStateStatus: string): Ci => {
  const failed = rollup.some((one) => FAILING.has(one.conclusion ?? ""));
  if (failed) return mergeStateStatus === "BLOCKED" ? "github-rejected" : "failing";
  const pending = rollup.some((one) => (one.status ?? "") !== "COMPLETED");
  return pending ? "pending" : "clean";
};

const run = async (cwd: string, args: ReadonlyArray<string>) => {
  const proc = Bun.spawn(["gh", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { out: out.trim(), err: err.trim(), code };
};

const repo = async (cwd: string) => {
  const found = await run(cwd, ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]);
  return found.code === 0 ? found.out : undefined;
};

type Threads = { readonly count: number } | { readonly problem: string };

const reviewThreads = async (
  cwd: string,
  owner: string,
  name: string,
  number: number,
): Promise<Threads> => {
  const query = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){nodes{isResolved}}}}}`;
  const found = await run(cwd, [
    "api",
    "graphql",
    "-F",
    `owner=${owner}`,
    "-F",
    `name=${name}`,
    "-F",
    `number=${number}`,
    "-f",
    `query=${query}`,
  ]);

  if (found.code !== 0) return { problem: found.err.split("\n")[0] ?? `exit ${found.code}` };

  const parsed: unknown = JSON.parse(found.out);
  const nodes = (
    parsed as {
      data?: { repository?: { pullRequest?: { reviewThreads?: { nodes?: ReadonlyArray<{ isResolved: boolean }> } } } };
    }
  ).data?.repository?.pullRequest?.reviewThreads?.nodes;

  if (nodes === undefined) return { problem: "the GraphQL reply had no reviewThreads" };
  return { count: nodes.filter((one) => !one.isResolved).length };
};

export type Read = {
  readonly snapshot: Snapshot;
  readonly problems: ReadonlyArray<string>;
};

/**
 * A row `gh` could not produce. It claims nothing: not conflict, not clean, not
 * no threads. `threads: -1` and `ci: "pending"` are both "unknown", and the
 * decision layer reads them as unknown rather than as good news.
 */
const unreadable = (number: number, reason: string): Read => ({
  snapshot: {
    number,
    kind: "open",
    mergeable: "UNKNOWN",
    mergeStateStatus: "UNKNOWN",
    isDraft: false,
    reviewDecision: "NONE",
    ci: "pending",
    threads: -1,
    mergedAt: null,
  },
  problems: [`#${number}: ${reason}`],
});

export const readPr = async (cwd: string, number: number): Promise<Read> => {
  const problems: Array<string> = [];

  if (Bun.which("gh") === null)
    return unreadable(number, "`gh` is not on PATH, so this row decides nothing");

  const found = await run(cwd, ["pr", "view", String(number), "--json", FIELDS]);
  if (found.code !== 0)
    return unreadable(number, found.err.split("\n")[0] ?? `gh exited ${found.code}`);

  const facts = JSON.parse(found.out) as Facts;
  const slug = await repo(cwd);
  let threads = -1;

  if (slug === undefined) {
    problems.push(`#${number}: could not resolve the repository, so review threads were not read`);
  } else {
    const [owner, name] = slug.split("/");
    const read = await reviewThreads(cwd, owner ?? "", name ?? "", number);
    if ("problem" in read) {
      problems.push(`#${number}: review threads unreadable, ${read.problem}`);
    } else {
      threads = read.count;
    }
  }

  const kind = facts.state === "MERGED" || facts.mergedAt !== null
    ? "merged"
    : facts.state === "CLOSED"
      ? "closed"
      : "open";

  return {
    snapshot: {
      number: facts.number,
      kind,
      mergeable: facts.mergeable,
      mergeStateStatus: facts.mergeStateStatus,
      isDraft: facts.isDraft,
      reviewDecision: facts.reviewDecision ?? "NONE",
      ci: ci(facts.statusCheckRollup, facts.mergeStateStatus),
      threads,
      mergedAt: facts.mergedAt,
    },
    problems,
  };
};

/** Lowest number first: a stacked branch set lands bottom-up, so that is the order. */
export const openPullRequests = async (cwd: string): Promise<ReadonlyArray<number>> => {
  const found = await run(cwd, [
    "pr",
    "list",
    "--state",
    "open",
    "--limit",
    "200",
    "--json",
    "number",
  ]);
  if (found.code !== 0) return [];

  const parsed: unknown = JSON.parse(found.out === "" ? "[]" : found.out);
  if (!Array.isArray(parsed)) return [];

  return (parsed as ReadonlyArray<{ number: number }>)
    .map((one) => one.number)
    .toSorted((a, b) => a - b);
};
