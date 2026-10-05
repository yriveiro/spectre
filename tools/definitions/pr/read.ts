import type { Finding } from "./fields";

/**
 * `git` and `gh` out, one verdict in. The only impure module of the three, and impure in
 * one shape: every process goes through `run` below.
 *
 * The operation converges. It reads what exists, compares against the desired state,
 * and acts on the difference, in that order: push only what the remote lacks, edit an
 * open pull request when one is on this branch, create only when none is. A run that
 * died after the push finds the branch current and pushes nothing; a run that died
 * after the create finds the pull request and rewrites it to the same bytes, which
 * `changed: false` reports. Nothing here reads what the previous attempt was doing.
 */

export type Run =
  | { readonly ran: true; readonly out: string; readonly err: string; readonly code: number }
  | { readonly ran: false; readonly err: string };

const spawn = async (cwd: string, program: string, args: ReadonlyArray<string>): Promise<Run> => {
  let proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
  try {
    proc = Bun.spawn([program, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  } catch (cause) {
    return { ran: false, err: cause instanceof Error ? cause.message : String(cause) };
  }
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { ran: true, out: out.trim(), err: err.trim(), code };
};

const git = (cwd: string, args: ReadonlyArray<string>) => spawn(cwd, "git", args);
const gh = (cwd: string, args: ReadonlyArray<string>) => spawn(cwd, "gh", args);

/** A command that ran and failed has not answered, so its exit is not evidence. */
const answered = (run: Run): run is Extract<Run, { readonly ran: true }> =>
  run.ran && run.code === 0;

/**
 * Why a command failed, from either arm. A spawn that never ran and one that ran and
 * exited non-zero are the same fact for the caller — this command did not answer — so
 * reporting only one of them would send a reader after the wrong problem.
 */
const why = (run: Run) =>
  !run.ran ? run.err : run.err === "" ? `exited ${run.code} with no message` : run.err;

/**
 * A branch name reaches an argv slot, and `git` and `gh` parse their own flags, so a
 * leading dash reads as an option: `--repo` is a repository selector, not a branch named
 * `repo`. `git` would refuse to create such a ref, which is what makes the HEAD case
 * unreachable. It is kept because `base` is a caller-supplied field, and nothing
 * upstream validates a field.
 */
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

export const branchOk = (one: string): boolean => BRANCH.test(one) && !one.includes("..");

export type Facts =
  | {
      readonly ok: true;
      readonly branch: string;
      readonly base: string;
      readonly upstream?: string;
      /** `NaN` when `rev-list` ran and failed, which is neither zero nor a count. */
      readonly ahead: number;
    }
  | { readonly ok: false; readonly problems: string };

const DEFAULT_BRANCH = "main";

type Named =
  | { readonly kind: "named"; readonly branch: string }
  | { readonly kind: "unreadable"; readonly why: string };

/**
 * The branch this pull request is from, as a sum rather than `string | undefined`: the
 * two failures are different facts, and a caller that collapses them sends a reader
 * after the wrong problem. Nothing is written until this resolves to a name.
 */
const branchOf = async (cwd: string): Promise<Named> => {
  const named = await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!answered(named))
    return { kind: "unreadable", why: `${cwd} is not a git repository, or has no commit yet` };
  if (named.out === "" || named.out === "HEAD")
    return {
      kind: "unreadable",
      why: `${cwd} is on a detached HEAD, so no branch names this pull request`,
    };
  return { kind: "named", branch: named.out };
};

const remoteOf = async (cwd: string, branch: string): Promise<string | undefined> => {
  const remote = await git(cwd, ["config", "--get", `branch.${branch}.remote`]);
  return answered(remote) && remote.out !== "" ? remote.out : undefined;
};

/**
 * `NaN` when `rev-list` ran and failed, and `NaN` is what the push decision reads as
 * "cannot tell", so the failure is a value here rather than an early return.
 */
const aheadOf = async (cwd: string, branch: string, upstream?: string): Promise<number> => {
  if (upstream === undefined) return Number.NaN;
  const counted = await git(cwd, ["rev-list", "--count", `${upstream}/${branch}..HEAD`]);
  return answered(counted) ? Number(counted.out) : Number.NaN;
};

/**
 * The caller's `base`, else what the repository says, else `main`. A default branch this
 * read cannot resolve falls back rather than refusing, because `base` is a field the
 * caller can correct and the create reports the branch it used, so a wrong guess is
 * visible rather than silent.
 */
const baseOf = async (cwd: string, base?: string): Promise<string> => {
  if (base !== undefined) return base;
  const found = await gh(cwd, [
    "repo",
    "view",
    "--json",
    "defaultBranchRef",
    "-q",
    ".defaultBranchRef.name",
  ]);
  return answered(found) && found.out !== "" ? found.out : DEFAULT_BRANCH;
};

/**
 * Every read that has to succeed before anything is written, gathered so a create never
 * starts from a directory whose branch nobody has named. The last two reads are
 * independent, so they run together rather than in sequence.
 */
export const read = async (cwd: string, base?: string): Promise<Facts> => {
  if (Bun.which("gh") === null) return { ok: false, problems: "`gh` is not on PATH" };

  const named = await branchOf(cwd);
  if (named.kind !== "named") return { ok: false, problems: named.why };

  if (base !== undefined && !branchOk(base))
    return { ok: false, problems: `\`base\` is not a branch name this tool will pass to git: ${base}` };

  const [upstream, ahead, target] = await Promise.all([
    remoteOf(cwd, named.branch),
    aheadOf(cwd, named.branch),
    baseOf(cwd, base),
  ]);

  return {
    ok: true,
    branch: named.branch,
    base: target,
    ahead,
    ...(upstream === undefined ? {} : { upstream }),
  };
};

/**
 * `NaN` reads as needing a push, because a comparison that failed is not a count of
 * zero: the only way to find out what the remote holds is to tell it.
 */
export const needsPush = (facts: Extract<Facts, { readonly ok: true }>) =>
  facts.upstream === undefined || Number.isNaN(facts.ahead) || facts.ahead > 0;

export type Pushed = { readonly pushed: boolean; readonly problems: string };

/**
 * No `--force`, and no flag that rewrites history, and there is no input that produces
 * one. A rejected push comes back as git's own refusal, which is the right answer for a
 * shared branch: a force-push to one is the human's call, every time.
 */
export const push = async (
  cwd: string,
  facts: Extract<Facts, { readonly ok: true }>,
): Promise<Pushed> => {
  if (!needsPush(facts)) return { pushed: false, problems: "" };

  const args =
    facts.upstream === undefined
      ? ["push", "--set-upstream", "origin", `HEAD:refs/heads/${facts.branch}`]
      : ["push", facts.upstream, `HEAD:refs/heads/${facts.branch}`];

  const result = await git(cwd, args);
  if (answered(result)) return { pushed: true, problems: "" };
  return { pushed: false, problems: `\`git push\` was refused: ${why(result)}` };
};

export type Existing =
  | { readonly kind: "open"; readonly number: number; readonly title: string; readonly body: string }
  | { readonly kind: "none" }
  | { readonly kind: "unreadable"; readonly problems: string };

type Row = { readonly number?: unknown; readonly title?: unknown; readonly body?: unknown };

/**
 * The reconciliation read. One open pull request on this branch, or none, or a reason the
 * answer is unknown — and unknown is never `none`, because "no pull request exists" is a
 * claim about the forge this read has not established.
 */
export const openPullRequest = async (cwd: string, branch: string): Promise<Existing> => {
  const found = await gh(cwd, [
    "pr",
    "list",
    "--head",
    branch,
    "--state",
    "open",
    "--limit",
    "1",
    "--json",
    "number,title,body",
  ]);
  if (!answered(found))
    return { kind: "unreadable", problems: `\`gh pr list\` failed: ${why(found)}` };

  let parsed: unknown;
  try {
    parsed = JSON.parse(found.out === "" ? "[]" : found.out);
  } catch {
    return { kind: "unreadable", problems: "`gh pr list` returned output that is not JSON" };
  }
  if (!Array.isArray(parsed))
    return { kind: "unreadable", problems: "`gh pr list` returned JSON that is not a list" };

  const first = parsed[0] as Row | undefined;
  if (first === undefined) return { kind: "none" };
  if (typeof first.number !== "number")
    return { kind: "unreadable", problems: "`gh pr list` returned a row with no number" };

  return {
    kind: "open",
    number: first.number,
    title: typeof first.title === "string" ? first.title : "",
    body: typeof first.body === "string" ? first.body : "",
  };
};

export type Written =
  | {
      readonly ok: true;
      readonly number: number;
      readonly url: string;
      readonly draft: boolean;
      readonly changed: boolean;
      readonly problems: string;
    }
  | { readonly ok: false; readonly problems: string };

export type Draft = { readonly title: string; readonly body: string };

type Confirmed = {
  readonly number: number;
  readonly url: string;
  readonly title: string;
  readonly body: string;
  readonly isDraft: boolean;
};

const carries = (row: Confirmed, draft: Draft) => row.title === draft.title && row.body === draft.body;

/**
 * The read-back is the check. A `gh` that exited zero has still not been believed, because
 * the output a human acts on is the URL and the title, and neither is in that exit code.
 * A pull request this cannot read back is reported unconfirmed rather than created.
 */
const confirm = async (cwd: string, selector: string): Promise<Confirmed | string> => {
  const view = await gh(cwd, ["pr", "view", selector, "--json", "number,url,title,body,isDraft"]);
  if (!answered(view)) return `\`gh pr view ${selector}\` failed: ${why(view)}`;

  let parsed: unknown;
  try {
    parsed = JSON.parse(view.out);
  } catch {
    return "`gh pr view` returned output that is not JSON";
  }
  const row = parsed as Record<string, unknown> | null;
  if (row === null || typeof row !== "object" || typeof row.number !== "number" || typeof row.url !== "string")
    return "`gh pr view` returned a pull request this tool does not accept";

  return {
    number: row.number,
    url: row.url,
    title: typeof row.title === "string" ? row.title : "",
    body: typeof row.body === "string" ? row.body : "",
    isDraft: row.isDraft === true,
  };
};

/**
 * The create path. `gh pr create` prints the URL, and that URL is the only handle the
 * read-back has, so a create that exited zero without one is a refusal rather than a
 * guess at which pull request was meant.
 */
const create = async (cwd: string, draft: Draft, base: string): Promise<Written> => {
  const made = await gh(cwd, [
    "pr",
    "create",
    "--title",
    draft.title,
    "--body",
    draft.body,
    "--base",
    base,
  ]);
  if (!answered(made)) return { ok: false, problems: `\`gh pr create\` failed: ${why(made)}` };

  const url = made.out.match(/https:\/\/\S+/)?.[0];
  if (url === undefined)
    return {
      ok: false,
      problems:
        "`gh pr create` reported success without a URL, so the pull request could not be identified",
    };

  const read = await confirm(cwd, url);
  if (typeof read === "string")
    return { ok: false, problems: `the pull request was created but ${read}` };

  return { ok: true, number: read.number, url: read.url, draft: read.isDraft, changed: true, problems: "" };
};

/**
 * The edit path, and the convergence: an open pull request on this branch is rewritten to
 * the composed bytes rather than a second one opened. `changed: false` is the answer a
 * re-run gives, and it is the property that makes running this twice safe.
 */
const edit = async (cwd: string, number: number, draft: Draft, base: string): Promise<Written> => {
  const before = await confirm(cwd, String(number));
  if (typeof before === "string")
    return { ok: false, problems: `#${number} could not be read, so nothing was edited: ${before}` };

  const held = carries(before, draft);

  if (!held) {
    const edited = await gh(cwd, [
      "pr",
      "edit",
      String(number),
      "--title",
      draft.title,
      "--body",
      draft.body,
      "--base",
      base,
    ]);
    if (!answered(edited))
      return { ok: false, problems: `\`gh pr edit #${number}\` failed: ${why(edited)}` };

    const after = await confirm(cwd, String(number));
    if (typeof after === "string")
      return { ok: false, problems: `#${number} was edited but could not be read back: ${after}` };
    if (!carries(after, draft))
      return { ok: false, problems: `#${after.number} does not carry the composed title and body` };

    return {
      ok: true,
      number: after.number,
      url: after.url,
      draft: after.isDraft,
      changed: true,
      problems: "",
    };
  }

  return {
    ok: true,
    number: before.number,
    url: before.url,
    draft: before.isDraft,
    changed: false,
    problems: "",
  };
};

export const write = async (
  cwd: string,
  draft: Draft,
  base: string,
  existing: Existing,
): Promise<Written> =>
  existing.kind === "open" ? edit(cwd, existing.number, draft, base) : create(cwd, draft, base);

export const findingsText = (found: ReadonlyArray<Finding>) =>
  found.map((one) => `${one.rule}: ${one.detail}`).join("\n");