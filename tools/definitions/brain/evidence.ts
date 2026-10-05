import { Effect } from "effect";

/**
 * Commits read per call. An unbounded `git log` on a large repository is a
 * context-window hazard, so every count in an Evidence is measured inside this
 * window and never claims to be a total.
 */
export const WINDOW = 200;

const TIMEOUT = 15_000;

const REPOSITORY_ENV = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR"];

/**
 * What git says about one subject path: how many commits in the WINDOW touched
 * it, the date of the newest of those, and how many of the other subject paths
 * share at least one of them. Counts and dates only, so the model never gets to
 * write down its own evidence.
 */
export type Evidence = {
  readonly path: string;
  readonly commits: number;
  readonly lastTouched: string | null;
  readonly coChange: number;
};

/**
 * The measurement for a whole subject. `rows` covers the paths the repository
 * knows, `missing` the ones it does not (reported, never skipped), and
 * `problems` says why git itself could not answer — no repository, git off
 * PATH, a call that timed out. Whenever the measurement could not be taken,
 * `rows` and `missing` are both empty: an empty answer never stands in for a
 * zero.
 */
export type EvidenceReport = {
  readonly rows: ReadonlyArray<Evidence>;
  readonly missing: ReadonlyArray<string>;
  readonly problems: ReadonlyArray<string>;
};

type Run = {
  readonly code: number;
  readonly out: string;
  readonly err: string;
};

type Commit = {
  readonly date: string;
  readonly files: ReadonlyArray<string>;
};

const environment = (): Record<string, string | undefined> => {
  const env: Record<string, string | undefined> = { ...Bun.env };
  for (const name of REPOSITORY_ENV) delete env[name];
  env.LC_ALL = "C";
  return env;
};

const run = async (
  directory: string,
  argv: ReadonlyArray<string>,
  env: Record<string, string | undefined>,
): Promise<Run> => {
  try {
    const proc = Bun.spawn(["git", ...argv], {
      cwd: directory,
      stdout: "pipe",
      stderr: "pipe",
      env,
    });
    const read = (async () => {
      const [out, err, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      return { code, out, err: err.trim() };
    })();
    // A git call on a network filesystem can hang; a session must not hang with it.
    const expired = Bun.sleep(TIMEOUT).then((): Run => {
      try {
        proc.kill();
      } catch {
        return { code: -1, out: "", err: `timed out after ${TIMEOUT}ms` };
      }
      return { code: -1, out: "", err: `timed out after ${TIMEOUT}ms` };
    });
    return await Promise.race([read, expired]);
  } catch (error) {
    return { code: -1, out: "", err: error instanceof Error ? error.message : String(error) };
  }
};

const failed = (what: string, result: Run): string =>
  result.err !== "" ? `git ${what} failed: ${result.err}` : `git ${what} exited ${result.code}`;

const parse = (out: string): ReadonlyArray<Commit> => {
  const commits: Array<Commit> = [];
  for (const part of out.split("\0")) {
    const lines = part.split("\n").filter((line) => line !== "");
    const date = lines[0];
    if (date !== undefined) commits.push({ date, files: lines.slice(1) });
  }
  return commits;
};

const covers = (path: string, file: string): boolean =>
  file === path || file.startsWith(path.endsWith("/") ? path : `${path}/`);

const holds = (path: string, known: ReadonlySet<string>): boolean => {
  for (const entry of known) if (covers(path, entry)) return true;
  return false;
};

const measure = async (
  directory: string,
  subject: ReadonlyArray<string>,
): Promise<EvidenceReport> => {
  try {
    const paths = [...new Set(subject)];
    if (paths.length === 0) return { rows: [], missing: [], problems: [] };

    const env = environment();
    if (Bun.which("git", { PATH: env.PATH }) === null)
      return { rows: [], missing: [], problems: ["git is not on PATH"] };

    const probe = await run(directory, ["rev-parse", "--git-dir"], env);
    if (probe.code !== 0)
      return {
        rows: [],
        missing: [],
        problems: [
          probe.err.includes("not a git repository")
            ? "not a git repository"
            : failed("rev-parse", probe),
        ],
      };

    const tracked = await run(
      directory,
      ["--literal-pathspecs", "ls-files", "-z", "--", ...paths],
      env,
    );
    if (tracked.code !== 0)
      return { rows: [], missing: [], problems: [failed("ls-files", tracked)] };
    const known = new Set(tracked.out.split("\0").filter((one) => one !== ""));

    const missing: Array<string> = [];
    const present: Array<string> = [];
    for (const path of paths) (holds(path, known) ? present : missing).push(path);
    if (present.length === 0) return { rows: [], missing, problems: [] };

    const history = await run(
      directory,
      [
        "-c",
        "log.showSignature=false",
        "log",
        "--relative",
        `--max-count=${WINDOW}`,
        "--name-only",
        "--format=%x00%aI",
      ],
      env,
    );
    if (history.code !== 0) return { rows: [], missing, problems: [failed("log", history)] };

    const counts = new Map<string, number>();
    const dates = new Map<string, string>();
    const links = new Map<string, Set<string>>();
    for (const commit of parse(history.out)) {
      const hit = present.filter((path) => commit.files.some((file) => covers(path, file)));
      if (hit.length === 0) continue;
      for (const path of hit) {
        counts.set(path, (counts.get(path) ?? 0) + 1);
        if (!dates.has(path)) dates.set(path, commit.date);
      }
      for (const path of hit) {
        const peers = links.get(path) ?? new Set<string>();
        for (const other of hit) if (other !== path) peers.add(other);
        links.set(path, peers);
      }
    }

    const rows = present.map((path) => ({
      path,
      commits: counts.get(path) ?? 0,
      lastTouched: dates.get(path) ?? null,
      coChange: links.get(path)?.size ?? 0,
    }));
    return { rows, missing, problems: [] };
  } catch (error) {
    return {
      rows: [],
      missing: [],
      problems: [`evidence failed: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
};

/**
 * One measurement over the subject paths, read-only against git: a repository
 * probe, one `ls-files` for what the repository knows, one bounded `log`
 * aggregated in memory — never a call per path, never a call per pair, never a
 * write to the index or the working tree. `directory` is the project directory,
 * the base git measures from; subject paths are relative to it. It does not
 * throw: anything git could not answer comes back in `problems`, and a missing
 * path comes back in `missing` rather than being skipped or counted as zero.
 */
export const evidence = (
  directory: string,
  subject: ReadonlyArray<string>,
): Effect.Effect<EvidenceReport> => Effect.promise(() => measure(directory, subject));
