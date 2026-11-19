import type { Finding } from "./fields";

export type Run =
  | { readonly ran: true; readonly out: string; readonly err: string; readonly code: number }
  | { readonly ran: false; readonly err: string };

export type Spawn = (
  cwd: string,
  program: string,
  args: ReadonlyArray<string>,
  stdin?: string,
) => Promise<Run>;

const spawn: Spawn = async (cwd, program, args, stdin) => {
  try {
    const proc = Bun.spawn([program, ...args], {
      cwd,
      stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
      stdout: "pipe",
      stderr: "pipe",
      env: { ...Bun.env, GIT_TERMINAL_PROMPT: "0" },
    });
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { ran: true, out: out.trim(), err: err.trim(), code };
  } catch (cause) {
    return { ran: false, err: cause instanceof Error ? cause.message : String(cause) };
  }
};

const answered = (run: Run): run is Extract<Run, { readonly ran: true }> =>
  run.ran && run.code === 0;

const why = (run: Run) =>
  !run.ran ? run.err : run.err === "" ? `exited ${run.code} with no message` : run.err;

const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

export const branchOk = (one: string): boolean => BRANCH.test(one) && !one.includes("..");

export type Facts =
  | {
      readonly ok: true;
      readonly branch: string;
      readonly base: string;
      readonly upstream?: string;
      readonly ahead: number;
    }
  | { readonly ok: false; readonly problems: string };

const DEFAULT_BRANCH = "main";

type Named =
  | { readonly kind: "named"; readonly branch: string }
  | { readonly kind: "unreadable"; readonly why: string };

const branchOf = async (cwd: string, run: Spawn): Promise<Named> => {
  const named = await run(cwd, "git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!answered(named))
    return { kind: "unreadable", why: `${cwd} is not a git repository, or has no commit yet` };
  if (named.out === "" || named.out === "HEAD")
    return {
      kind: "unreadable",
      why: `${cwd} is on a detached HEAD, so no branch names this pull request`,
    };
  return { kind: "named", branch: named.out };
};

const remoteOf = async (cwd: string, branch: string, run: Spawn): Promise<string | undefined> => {
  const remote = await run(cwd, "git", ["config", "--get", `branch.${branch}.remote`]);
  return answered(remote) && remote.out !== "" ? remote.out : undefined;
};

const aheadOf = async (
  cwd: string,
  branch: string,
  upstream: string | undefined,
  run: Spawn,
): Promise<number> => {
  if (upstream === undefined) return Number.NaN;
  const counted = await run(cwd, "git", ["rev-list", "--count", `${upstream}/${branch}..HEAD`]);
  return answered(counted) ? Number(counted.out) : Number.NaN;
};

const baseOf = async (cwd: string, base: string | undefined, run: Spawn): Promise<string> => {
  if (base !== undefined) return base;
  const found = await run(cwd, "gh", [
    "repo",
    "view",
    "--json",
    "defaultBranchRef",
    "-q",
    ".defaultBranchRef.name",
  ]);
  return answered(found) && found.out !== "" ? found.out : DEFAULT_BRANCH;
};

export const read = async (cwd: string, base?: string, run: Spawn = spawn): Promise<Facts> => {
  if (run === spawn && Bun.which("gh") === null)
    return { ok: false, problems: "`gh` is not on PATH" };

  const named = await branchOf(cwd, run);
  if (named.kind !== "named") return { ok: false, problems: named.why };

  if (base !== undefined && !branchOk(base))
    return {
      ok: false,
      problems: `\`base\` is not a branch name this tool will pass to git: ${base}`,
    };

  const [[upstream, ahead], target] = await Promise.all([
    remoteOf(cwd, named.branch, run).then(
      async (foundUpstream) =>
        [foundUpstream, await aheadOf(cwd, named.branch, foundUpstream, run)] as const,
    ),
    baseOf(cwd, base, run),
  ]);

  return {
    ok: true,
    branch: named.branch,
    base: target,
    ahead,
    ...(upstream === undefined ? {} : { upstream }),
  };
};

export type CommitOutcome =
  | { readonly ok: true; readonly committed: boolean }
  | { readonly ok: false; readonly problems: string };

const SIGNING_ERROR = /gpg failed to sign|signing failed|secret key not available|No pinentry/i;

export const commitChanges = async (
  cwd: string,
  commitMessage: string,
  files: ReadonlyArray<string>,
  run: Spawn = spawn,
): Promise<CommitOutcome> => {
  const [headMsg, dirty] = await Promise.all([
    run(cwd, "git", ["log", "-1", "--format=%B", "HEAD"]),
    run(cwd, "git", ["status", "--porcelain", "--", ...files]),
  ]);

  if (
    answered(headMsg) &&
    answered(dirty) &&
    headMsg.out.trim() === commitMessage.trim() &&
    dirty.out === ""
  ) {
    return { ok: true, committed: false };
  }

  const added = await run(cwd, "git", ["add", "--", ...files]);
  if (!answered(added)) return { ok: false, problems: `\`git add\` failed: ${why(added)}` };

  const staged = await run(cwd, "git", ["diff", "--cached", "--name-only"]);
  if (answered(staged) && staged.out === "")
    return {
      ok: false,
      problems: "nothing is staged after `git add --`: none of `commit.files` had changes",
    };

  const committed = await run(cwd, "git", ["commit", "-m", commitMessage]);
  if (answered(committed)) return { ok: true, committed: true };

  const detail = why(committed);
  if (SIGNING_ERROR.test(detail))
    return {
      ok: false,
      problems: `\`git commit\` signing failed (${detail}). Call \`yubikey_unlock\` once to cache your PIN in gpg-agent, then re-run \`tools.spectre.pr\`.`,
    };
  return { ok: false, problems: `\`git commit\` failed: ${detail}` };
};

export const needsPush = (facts: Extract<Facts, { readonly ok: true }>) =>
  facts.upstream === undefined || Number.isNaN(facts.ahead) || facts.ahead > 0;

export type SshRemote = { readonly host: string; readonly prefix: string };

export const sshRemoteHost = (remoteUrl: string): SshRemote | undefined => {
  const trimmed = remoteUrl.trim();
  const sshProto = /^ssh:\/\/(?:[^@/\s]+@)?([A-Za-z0-9.-]+)\//.exec(trimmed);
  if (sshProto?.[1] !== undefined) return { host: sshProto[1], prefix: sshProto[0] };

  if (trimmed.includes("://")) return undefined;
  const scp = /^([A-Za-z0-9._-]+@([A-Za-z0-9.-]+):)/.exec(trimmed);
  if (scp?.[1] !== undefined && scp[2] !== undefined) return { host: scp[2], prefix: scp[1] };
  return undefined;
};

const SSH_AUTH_REFUSAL =
  /Permission denied \(publickey\)|signing failed for [A-Z0-9-]+-SK|agent refused operation|Could not read from remote repository/i;

export type Pushed = { readonly pushed: boolean; readonly problems: string };

export const push = async (
  cwd: string,
  facts: Extract<Facts, { readonly ok: true }>,
  run: Spawn = spawn,
): Promise<Pushed> => {
  if (!needsPush(facts)) return { pushed: false, problems: "" };

  const remoteName = facts.upstream ?? "origin";
  const args =
    facts.upstream === undefined
      ? ["push", "--set-upstream", "origin", `HEAD:refs/heads/${facts.branch}`]
      : ["push", facts.upstream, `HEAD:refs/heads/${facts.branch}`];

  const result = await run(cwd, "git", args);
  if (answered(result)) return { pushed: true, problems: "" };

  const firstProblem = why(result);
  if (SSH_AUTH_REFUSAL.test(firstProblem)) {
    const urlRun = await run(cwd, "git", ["remote", "get-url", remoteName]);
    const ssh = answered(urlRun) ? sshRemoteHost(urlRun.out) : undefined;
    if (ssh !== undefined) {
      const auth = await run(cwd, "gh", ["auth", "status", "--hostname", ssh.host]);
      if (answered(auth)) {
        const retry = await run(cwd, "git", [
          "-c",
          `url.https://${ssh.host}/.insteadOf=${ssh.prefix}`,
          "-c",
          `credential.https://${ssh.host}.helper=!gh auth git-credential`,
          ...args,
        ]);
        if (answered(retry)) return { pushed: true, problems: "" };
      }
    }
  }

  return { pushed: false, problems: `\`git push\` was refused: ${firstProblem}` };
};

export type Existing =
  | {
      readonly kind: "open";
      readonly number: number;
      readonly title: string;
      readonly body: string;
    }
  | { readonly kind: "none" }
  | { readonly kind: "unreadable"; readonly problems: string };

type Row = { readonly number?: unknown; readonly title?: unknown; readonly body?: unknown };

export const openPullRequest = async (
  cwd: string,
  branch: string,
  run: Spawn = spawn,
): Promise<Existing> => {
  const found = await run(cwd, "gh", [
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

const carries = (row: Confirmed, draft: Draft) =>
  row.title === draft.title && row.body === draft.body;

const confirm = async (cwd: string, selector: string, run: Spawn): Promise<Confirmed | string> => {
  const view = await run(cwd, "gh", [
    "pr",
    "view",
    selector,
    "--json",
    "number,url,title,body,isDraft",
  ]);
  if (!answered(view)) return `\`gh pr view ${selector}\` failed: ${why(view)}`;

  let parsed: unknown;
  try {
    parsed = JSON.parse(view.out);
  } catch {
    return "`gh pr view` returned output that is not JSON";
  }
  const row = parsed as Record<string, unknown> | null;
  if (
    row === null ||
    typeof row !== "object" ||
    typeof row.number !== "number" ||
    typeof row.url !== "string"
  )
    return "`gh pr view` returned a pull request this tool does not accept";

  return {
    number: row.number,
    url: row.url,
    title: typeof row.title === "string" ? row.title : "",
    body: typeof row.body === "string" ? row.body : "",
    isDraft: row.isDraft === true,
  };
};

const create = async (cwd: string, draft: Draft, base: string, run: Spawn): Promise<Written> => {
  const made = await run(cwd, "gh", [
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

  const readBack = await confirm(cwd, url, run);
  if (typeof readBack === "string")
    return { ok: false, problems: `the pull request was created but ${readBack}` };

  return {
    ok: true,
    number: readBack.number,
    url: readBack.url,
    draft: readBack.isDraft,
    changed: true,
    problems: "",
  };
};

// REST PATCH via `--input -` avoids `gh pr edit`'s `read:org` GraphQL query and `gh api -f`'s `{owner}`/`@file` interpolation.
const edit = async (
  cwd: string,
  number: number,
  draft: Draft,
  base: string,
  run: Spawn,
): Promise<Written> => {
  const before = await confirm(cwd, String(number), run);
  if (typeof before === "string")
    return {
      ok: false,
      problems: `#${number} could not be read, so nothing was edited: ${before}`,
    };

  if (!carries(before, draft)) {
    const payload = JSON.stringify({ title: draft.title, body: draft.body, base });
    const edited = await run(
      cwd,
      "gh",
      ["api", `repos/{owner}/{repo}/pulls/${number}`, "-X", "PATCH", "--input", "-"],
      payload,
    );
    if (!answered(edited))
      return { ok: false, problems: `updating PR #${number} failed: ${why(edited)}` };

    const after = await confirm(cwd, String(number), run);
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
  run: Spawn = spawn,
): Promise<Written> =>
  existing.kind === "open"
    ? edit(cwd, existing.number, draft, base, run)
    : create(cwd, draft, base, run);

export const findingsText = (found: ReadonlyArray<Finding>) =>
  found.map((one) => `${one.rule}: ${one.detail}`).join("\n");
