import { Schema } from "effect";
import { type ParsedFile, parseDiff } from "./parse";

/**
 * `gh` and `git` out, a verified subject and a verified diff in. The only impure
 * module of the three, and it is impure in one shape: every process goes through
 * `run` below, which is `stack/read.ts`'s helper with the program as an argument
 * so one function serves `gh` and `git`. A row this module could not read claims
 * nothing: it returns a reason and never a reassuring default.
 */

export type State = "open" | "closed" | "merged";

/**
 * `gh` reports `OPEN`, `CLOSED` and `MERGED`, and a fourth value would let a
 * canvas say "closed" about something `gh` never said. An unrecognised state is
 * therefore `undefined`, which the caller reports, rather than a fourth literal.
 *
 * The other copy of this normalisation is `stack/read.ts`, which does the same
 * six lines inline against the same three states. Not imported from here because
 * a definition folder reaches only its own internals, and `worktrees/read.ts` and
 * `stack/read.ts` already duplicate their `gh` shapes for the same reason.
 */
export const stateOf = (raw: string): State | undefined =>
  raw === "OPEN" ? "open" : raw === "CLOSED" ? "closed" : raw === "MERGED" ? "merged" : undefined;

const SEGMENT = /^[A-Za-z0-9._-]+$/;

const TRAVERSAL = new Set([".", ".."]);

/**
 * A segment may not start with `-`. That is the whole injection surface here:
 * `Bun.spawn` passes argv, so there is no shell to break out of, but `gh` and
 * `git` parse their own argv and a leading dash reads as a flag — `--repo` is a
 * repository selector, not a repository named "repo".
 *
 * `~` and `^` are refused too, which costs `HEAD~1`. Deliberate: the same
 * allowlist covers a branch name, a tag and a SHA, and widening it to reach one
 * convenience spelling would widen it for every ref the tool ever takes.
 */
const segmentOk = (one: string): boolean =>
  SEGMENT.test(one) && !one.startsWith("-") && !TRAVERSAL.has(one);

export const refOf = (raw: string): string | undefined => {
  if (raw === "") return undefined;
  const segments = raw.split("/");
  return segments.every(segmentOk) ? raw : undefined;
};

/** Two allowlisted segments and one separator. A slug is not a path. */
export const slugOf = (raw: string): string | undefined => {
  const parts = raw.split("/");
  if (parts.length !== 2) return undefined;
  const owner = refOf(parts[0] ?? "");
  const name = refOf(parts[1] ?? "");
  return owner === undefined || name === undefined ? undefined : `${owner}/${name}`;
};

const URL = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/([0-9]+)$/;

export type UrlRead =
  | { readonly ok: true; readonly repository: string; readonly number: number }
  | { readonly ok: false; readonly why: string };

/**
 * A URL is its own input arm rather than `repo` plus `pr`, because splitting it
 * is a parse whose failure is silent: a wrong repository with a valid number is
 * a different pull request, not an error. `gh` validates the URL itself; this
 * exists so the URL cannot become a flag before `gh` sees it, and so the subject
 * can name the repository the URL named.
 */
export const pullRequestUrl = (url: string): UrlRead => {
  const found = URL.exec(url);
  const owner = refOf(found?.[1] ?? "");
  const name = refOf(found?.[2] ?? "");
  const number = Number(found?.[3]);
  if (owner === undefined || name === undefined || !Number.isInteger(number) || number < 1)
    return {
      ok: false,
      why: `not a GitHub pull request URL: ${url}. Expected https://github.com/OWNER/REPO/pull/NUMBER`,
    };
  return { ok: true, repository: `${owner}/${name}`, number };
};

export type PrTarget =
  | { readonly kind: "number"; readonly number: number }
  | { readonly kind: "url"; readonly url: string };

export type Input =
  | { readonly pr: number }
  | { readonly url: string }
  | { readonly base: string; readonly head: string };

const PR_FIELDS =
  "number,title,state,baseRefName,headRefName,headRefOid,additions,deletions,changedFiles,url,author,body,isDraft";

/** `--patch` is never an argument here: its mail body is prose full of `-` bullets. */
export const viewArgs = (selector: string): ReadonlyArray<string> => [
  "pr",
  "view",
  selector,
  "--json",
  PR_FIELDS,
];

export const diffArgs = (selector: string): ReadonlyArray<string> => [
  "pr",
  "diff",
  selector,
  "--color",
  "never",
];

export const gitDiffArgs = (base: string, head: string): ReadonlyArray<string> => [
  "diff",
  "--no-color",
  `${base}...${head}`,
];

export const revParseArgs = (ref: string): ReadonlyArray<string> => [
  "rev-parse",
  "--verify",
  "--quiet",
  `${ref}^{commit}`,
];

type Facts = {
  readonly number: number;
  readonly title: string;
  readonly state: string;
  readonly baseRefName: string;
  readonly headRefName: string;
  readonly headRefOid: string;
  readonly additions: number;
  readonly deletions: number;
  readonly changedFiles: number;
  readonly url: string;
  readonly author: { readonly login: string };
  readonly body: string;
  readonly isDraft: boolean;
};

const FactsSchema = Schema.Struct({
  number: Schema.Number,
  title: Schema.String,
  state: Schema.String,
  baseRefName: Schema.String,
  headRefName: Schema.String,
  headRefOid: Schema.String,
  additions: Schema.Number,
  deletions: Schema.Number,
  changedFiles: Schema.Number,
  url: Schema.String,
  author: Schema.Struct({ login: Schema.String }),
  body: Schema.String,
  isDraft: Schema.Boolean,
});

/**
 * The `local-diff` arm has no `number`, `url`, `title`, `author` or `state`, and
 * not as optionals: an optional puts the field back on the type, and the field's
 * absence is what stops a local diff from implying a pull request exists.
 */
export type PullRequestSubject = {
  readonly kind: "pull-request";
  readonly number: number;
  readonly repository: string;
  readonly url: string;
  readonly title: string;
  readonly author: string;
  readonly state: State;
  readonly headSha: string;
  readonly baseRef: string;
  readonly headRef: string;
  readonly additions: number;
  readonly deletions: number;
  readonly changedFiles: number;
  readonly isDraft: boolean;
  readonly body: string;
};

export type LocalDiffSubject = {
  readonly kind: "local-diff";
  readonly base: string;
  readonly head: string;
  readonly headSha: string;
};

export type Subject = PullRequestSubject | LocalDiffSubject;

export type Totals = {
  readonly files: number;
  readonly additions: number;
  readonly deletions: number;
};

/**
 * A cross-check that cannot be performed is its own arm rather than a passing
 * one: a local diff has no `gh` to disagree with it, and reporting that as a
 * match would say the counts were verified by something that never ran.
 */
export type CrossCheck =
  | { readonly kind: "matched"; readonly parsed: Totals; readonly reported: Totals }
  | {
      readonly kind: "mismatched";
      readonly parsed: Totals;
      readonly reported: Totals;
      readonly why: string;
    }
  | { readonly kind: "no-oracle"; readonly parsed: Totals; readonly why: string };

export type Read =
  | {
      readonly status: "read";
      readonly subject: Subject;
      readonly files: ReadonlyArray<ParsedFile>;
      readonly cross: CrossCheck;
      readonly problems: ReadonlyArray<string>;
    }
  | { readonly status: "refused"; readonly problem: string };

export type Spawned =
  | { readonly ran: true; readonly out: string; readonly err: string; readonly code: number }
  | { readonly ran: false; readonly err: string };

/**
 * `Bun.spawn` throws `ENOENT` from `posix_spawn` for a `cwd` that is not there
 * rather than exiting non-zero, measured on Bun 1.4.2. A missing checkout is an
 * answer here and not an exception, so it comes back as `ran: false`.
 */
export const run = async (cwd: string, argv: ReadonlyArray<string>): Promise<Spawned> => {
  let proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
  try {
    proc = Bun.spawn([...argv], { cwd, stdout: "pipe", stderr: "pipe" });
  } catch (cause) {
    const why = cause instanceof Error ? cause.message : String(cause);
    return { ran: false, err: `${argv[0] ?? "?"} in ${cwd}: ${why}` };
  }
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { ran: true, out: out.trim(), err: err.trim(), code };
};

const firstLine = (err: string, code: number): string => {
  const line = err.split("\n").find((one) => one.trim() !== "");
  return line === undefined ? `exited ${code} with no message` : line.trim();
};

export const totalsOf = (files: ReadonlyArray<ParsedFile>): Totals => ({
  files: files.length,
  additions: files.reduce((sum, one) => sum + (one.status === "read" ? one.additions : 0), 0),
  deletions: files.reduce((sum, one) => sum + (one.status === "read" ? one.deletions : 0), 0),
});

/**
 * Whether the parser's counts and `gh`'s counts agree, and what the difference
 * was. Exported because it is the one claim this module makes about itself, and
 * a claim with no reachable test is a claim that cannot fail.
 */
export const crossChecked = (parsed: Totals, reported: Totals): CrossCheck => {
  if (parsed.additions !== reported.additions || parsed.deletions !== reported.deletions)
    return {
      kind: "mismatched",
      parsed,
      reported,
      why: `parsed ${parsed.additions}/${parsed.deletions} against gh's ${reported.additions}/${reported.deletions}`,
    };
  if (parsed.files !== reported.files)
    return {
      kind: "mismatched",
      parsed,
      reported,
      why: `parsed ${parsed.files} files against gh's ${reported.files}`,
    };
  return { kind: "matched", parsed, reported };
};

const readPullRequest = async (cwd: string, target: PrTarget): Promise<Read> => {
  const selector = target.kind === "number" ? String(target.number) : target.url;

  const viewed = await run(cwd, ["gh", ...viewArgs(selector)]);
  if (!viewed.ran) return { status: "refused", problem: viewed.err };
  if (viewed.code !== 0)
    return { status: "refused", problem: `gh pr view: ${firstLine(viewed.err, viewed.code)}` };

  const facts = factsOf(viewed.out);
  if (facts === undefined)
    return { status: "refused", problem: "gh pr view returned output this reader does not accept" };

  const state = stateOf(facts.state);
  if (state === undefined)
    return {
      status: "refused",
      problem: `gh reported a pull request state this reader does not know: ${facts.state}`,
    };

  const headSha = facts.headRefOid;

  const diffed = await run(cwd, ["gh", ...diffArgs(selector)]);
  if (!diffed.ran) return { status: "refused", problem: diffed.err };
  if (diffed.code !== 0)
    return { status: "refused", problem: `gh pr diff: ${firstLine(diffed.err, diffed.code)}` };

  const parsed = parseDiff(diffed.out);
  if (parsed.status === "unreadable") return { status: "refused", problem: parsed.reason };

  // The pin, checked. `gh pr diff` describes whatever the head is at the moment
  // it runs, so the head is read again afterwards: a pull request that moved
  // mid-gather would otherwise be described as one commit while the diff on the
  // table is another.
  const after = await run(cwd, ["gh", ...viewArgs(selector)]);
  const reread = after.ran && after.code === 0 ? factsOf(after.out) : undefined;
  const problems =
    reread !== undefined && reread.headRefOid === headSha
      ? []
      : [
          `the head moved while the diff was read: pinned ${headSha}, now ${reread?.headRefOid ?? "unknown"}`,
        ];

  const read: Read = {
    status: "read",
    subject: {
      kind: "pull-request",
      number: facts.number,
      repository: repositoryOf(target, facts.url),
      url: facts.url,
      title: facts.title,
      author: facts.author.login,
      state,
      headSha,
      baseRef: facts.baseRefName,
      headRef: facts.headRefName,
      additions: facts.additions,
      deletions: facts.deletions,
      changedFiles: facts.changedFiles,
      isDraft: facts.isDraft,
      body: facts.body,
    },
    files: parsed.files,
    cross: crossChecked(totalsOf(parsed.files), {
      files: facts.changedFiles,
      additions: facts.additions,
      deletions: facts.deletions,
    }),
    problems,
  };
  return read;
};

const factsOf = (raw: string): Facts | undefined => {
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const facts = Schema.decodeUnknownOption(FactsSchema)(decoded);
  return facts._tag === "None" ? undefined : facts.value;
};

/**
 * A number names a repository only through the cwd it was read in, so `gh`'s own
 * `url` is the repository of record. A URL arm is allowlisted twice: once on the
 * way in, and here against what `gh` reported, so a subject never names a
 * repository the pull request is not in.
 */
const HOST = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\//;

const repositoryOf = (target: PrTarget, reported: string): string => {
  const named = target.kind === "url" ? pullRequestUrl(target.url) : undefined;
  if (named?.ok) return named.repository;
  const host = HOST.exec(reported);
  const owner = host?.[1];
  const name = host?.[2];
  return (
    slugOf(owner === undefined || name === undefined ? "" : `${owner}/${name}`) ?? "unknown/unknown"
  );
};

const readLocalDiff = async (cwd: string, base: string, head: string): Promise<Read> => {
  const safeBase = refOf(base);
  const safeHead = refOf(head);
  if (safeBase === undefined)
    return { status: "refused", problem: `base ref is not an allowlisted ref: ${base}` };
  if (safeHead === undefined)
    return { status: "refused", problem: `head ref is not an allowlisted ref: ${head}` };

  const rev = await run(cwd, ["git", ...revParseArgs(safeHead)]);
  if (!rev.ran) return { status: "refused", problem: rev.err };
  if (rev.code !== 0 || rev.out === "")
    return {
      status: "refused",
      problem: `head ${safeHead} does not resolve to a commit in this repository`,
    };

  const diffed = await run(cwd, ["git", ...gitDiffArgs(safeBase, safeHead)]);
  if (!diffed.ran) return { status: "refused", problem: diffed.err };
  if (diffed.code !== 0)
    return {
      status: "refused",
      problem: `git diff ${safeBase}...${safeHead}: ${firstLine(diffed.err, diffed.code)}`,
    };

  const parsed = parseDiff(diffed.out);
  if (parsed.status === "unreadable") return { status: "refused", problem: parsed.reason };

  const totals = totalsOf(parsed.files);
  return {
    status: "read",
    subject: { kind: "local-diff", base: safeBase, head: safeHead, headSha: rev.out },
    files: parsed.files,
    cross: {
      kind: "no-oracle",
      parsed: totals,
      why: "a local diff has no pull request to check its counts against, so these are the parser's own",
    },
    problems: [],
  };
};

/**
 * `Bun.which` is checked before anything else, and its absence is a refusal
 * rather than an empty read: a canvas built from a read that never ran would
 * claim an empty diff where there is an unreadable one.
 */
export const read = async (cwd: string, input: Input): Promise<Read> => {
  if (Bun.which("git") === null)
    return { status: "refused", problem: "`git` is not on PATH, so no diff could be read" };

  if ("base" in input || "head" in input) {
    if (!("base" in input) || !("head" in input))
      return {
        status: "refused",
        problem: "a local diff needs both `base` and `head`; neither is inferred",
      };
    return readLocalDiff(cwd, input.base, input.head);
  }

  if (Bun.which("gh") === null)
    return { status: "refused", problem: "`gh` is not on PATH, so no pull request could be read" };

  if ("pr" in input) {
    if (!Number.isInteger(input.pr) || input.pr < 1)
      return { status: "refused", problem: `not a pull request number: ${String(input.pr)}` };
    return readPullRequest(cwd, { kind: "number", number: input.pr });
  }

  const url = pullRequestUrl(input.url);
  if (!url.ok) return { status: "refused", problem: url.why };
  return readPullRequest(cwd, { kind: "url", url: input.url });
};
