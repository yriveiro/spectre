import { type Blame, type Commit, FORMAT, parse, parsePorcelain } from "./parse";

export type Ownership = {
  readonly commits: number;
  readonly authors: number;
  readonly major: {
    readonly author: string;
    readonly commits: number;
    readonly share: number;
  };
  readonly minor: number;
};

/**
 * Ownership over every commit in the file's history, not over the window the
 * caller asked to see. An author whose share is under 5% counts as a minor
 * contributor, and how many of those a file carries is the strongest single
 * predictor in the defect literature: many small hands mean the file's meaning
 * sits in no one's head.
 */
export const ownershipOf = (commits: ReadonlyArray<Commit>): Ownership | null => {
  if (commits.length === 0) return null;
  const byAuthor = new Map<string, number>();
  for (const commit of commits) byAuthor.set(commit.author, (byAuthor.get(commit.author) ?? 0) + 1);
  const ranked = [...byAuthor].toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const total = commits.length;
  const share = (count: number) => count / total;
  const top = ranked[0]!;
  return {
    commits: total,
    authors: ranked.length,
    major: { author: top[0], commits: top[1], share: share(top[1]) },
    minor: ranked.filter(([, count]) => share(count) < 0.05).length,
  };
};

export type Report = {
  readonly path: string;
  readonly found: boolean;
  readonly introducedBy: Commit | null;
  readonly commits: ReadonlyArray<Commit>;
  readonly blame: Blame | null;
  readonly ownership: Ownership | null;
  readonly reverts: number;
  readonly authors: ReadonlyArray<string>;
  readonly first: string | null;
  readonly last: string | null;
  /** The commit bodies, which is where the rationale actually is. */
  readonly bodies: number;
  readonly problems: ReadonlyArray<string>;
};

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
  return { out, err: err.trim(), code };
};

const log = async (
  cwd: string,
  file: string,
  args: ReadonlyArray<string>,
): Promise<ReadonlyArray<Commit>> => {
  const found = await run(cwd, ["log", `--format=${FORMAT}`, ...args, "--", file]);
  return found.code === 0 ? parse(found.out) : [];
};

export const DEFAULT_LIMIT = 20;

export const history = async (
  directory: string,
  input: {
    readonly path: string;
    readonly limit?: number;
    readonly line?: number;
    readonly contains?: string;
    readonly matches?: string;
  },
): Promise<Report> => {
  const limit = input.limit ?? DEFAULT_LIMIT;
  const problems: Array<string> = [];

  const tracked = await run(directory, ["ls-files", "--error-unmatch", input.path]);
  if (tracked.code !== 0) {
    const onDisk = await Bun.file(
      input.path.startsWith("/") ? input.path : `${directory}/${input.path}`,
    ).exists();
    return {
      path: input.path,
      found: false,
      introducedBy: null,
      commits: [],
      blame: null,
      ownership: null,
      reverts: 0,
      authors: [],
      first: null,
      last: null,
      bodies: 0,
      problems: [
        onDisk
          ? `${input.path} exists but git does not track it, so it has no history`
          : `${input.path} is not in the repository`,
      ],
    };
  }

  // `contains` asks the message. `matches` asks the diff, which is the
  // pickaxe: the commits that added or removed this exact text. The second is
  // how you find the commit that introduced a line nobody wrote a message about.
  const filter: Array<string> = [];
  if (input.contains !== undefined) filter.push(`--grep=${input.contains}`, "--fixed-strings");
  if (input.matches !== undefined) filter.push(`-S${input.matches}`);
  const commits = await log(directory, input.path, [`--max-count=${limit}`, ...filter]);

  const added = await log(directory, input.path, ["--diff-filter=A", "--max-count=1"]);
  const introducedBy = added[0] ?? null;

  let blame: Blame | null = null;
  if (input.line !== undefined) {
    // Porcelain, not `-s`. The short form is `<sha> <line>) <text>`: no author,
    // no date, and a caret-prefixed sha on a boundary commit. The long form has
    // the two fields this reports on and is line-oriented key/value, so a name
    // containing spaces cannot move a field boundary.
    const found = await run(directory, [
      "blame",
      "--line-porcelain",
      "-L",
      `${input.line},${input.line}`,
      input.path,
    ]);
    if (found.code === 0) {
      const read = parsePorcelain(found.out, input.line);
      if (read === null) problems.push(`line ${input.line} came back without a commit header`);
      else blame = read;
    } else
      problems.push(
        `line ${input.line} could not be blamed: ${found.err || `git exited ${found.code}`}`,
      );
  }

  const total = await log(directory, input.path, ["--max-count=100000"]);
  const cut = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const recent = total.filter((one) => one.date >= cut);
  if (recent.length > 0 && total.length > recent.length)
    problems.push(
      `${recent.length} of the last ${total.length} commits to this file are under 90 days old, so its shape is still moving`,
    );

  return {
    path: input.path,
    found: true,
    introducedBy,
    commits,
    blame,
    ownership: ownershipOf(total),
    reverts: commits.filter((one) => one.reverts).length,
    authors: [...new Set(commits.map((one) => one.author))],
    first: total.at(-1)?.date ?? null,
    last: commits[0]?.date ?? null,
    // How much of what came back actually carries a rationale. A history of
    // subjects and no bodies cannot answer why, and the caller should not have
    // to read every row to discover that.
    bodies: commits.filter((one) => one.body !== "").length,
    problems,
  };
};
