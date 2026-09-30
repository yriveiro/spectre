import { basename } from "node:path";
import type { Plugin } from "@opencode/plugin/effect";
import { AbsolutePath } from "@opencode/schema/schema";
import type { Session } from "@opencode/schema/session";
import { Effect } from "effect";
import { prFor, type PullRequest, type Tracked, trackedChanges, trackedOf } from "../classify";
import { answered, git as run, listed, mainOf, pullRequests } from "../read";
import type { Branch, Landing, Standing } from "./home";

/**
 * The gate. `Bun.file(dir).exists()` is false for a directory — measured on this
 * machine — so it answers the wrong question. `stat()` reports `isDirectory` for a
 * directory and throws ENOENT for a path that is not there, so the absence is the
 * `catch` and no separate existence probe is needed.
 */
export const isDirectory = async (path: string): Promise<boolean> => {
  try {
    const info = await Bun.file(path).stat();
    return info.isDirectory();
  } catch {
    return false;
  }
};

const tracked = (porcelain: string): Tracked => trackedOf(trackedChanges(porcelain));

const count = (out: string): number | undefined => {
  const n = Number(out);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

const nameOf = async (
  rows: ReadonlyArray<{ readonly directory: string; readonly branch?: string }>,
  lost: string,
  main: string,
): Promise<Branch> => {
  const row = rows.find((one) => one.directory === lost);
  if (row?.branch !== undefined) return { kind: "named-by-git", name: row.branch };

  const guess = basename(lost);
  const ref = await run(main, ["show-ref", "--verify", "--quiet", `refs/heads/${guess}`]);
  if (answered(ref)) return { kind: "recovered-from-path", name: guess };
  return { kind: "unrecoverable", why: `git lists no row for ${lost} and has no branch named ${guess}` };
};

/**
 * Ancestry alone reports landed work as unlanded after a squash-merge, so a MERGED
 * pull request is accepted as the second proof.
 */
const landed = async (
  branch: Branch,
  main: string,
  prs: ReadonlyArray<PullRequest>,
): Promise<Landing> => {
  if (branch.kind === "unrecoverable") return { kind: "unknown", why: branch.why };

  const ancestor = await run(main, ["merge-base", "--is-ancestor", `${branch.name}^{commit}`, "origin/main"]);
  if (answered(ancestor)) return { kind: "on-main", by: "ancestor" };
  if (prFor(branch.name, prs).includes("MERGED")) return { kind: "on-main", by: "merged-pr" };

  const ahead = await run(main, ["rev-list", "--count", `origin/main..${branch.name}`]);
  if (!ahead.ran || ahead.code !== 0)
    return { kind: "unknown", why: `git could not compare ${branch.name} with origin/main` };

  const since = count(ahead.out);
  if (since === undefined) return { kind: "unknown", why: `git returned no count for ${branch.name}` };
  return since > 0
    ? { kind: "not-on-main", since }
    : { kind: "on-main", by: "ancestor" };
};

const nothing = (session: Session.ID, lost: AbsolutePath, why: string): Standing => ({
  session,
  where: { lost, onDisk: false },
  main: { kind: "absent", why },
  behind: undefined,
  branch: { kind: "unrecoverable", why },
  landing: { kind: "unknown", why },
});

export const ask = (
  ctx: Plugin.Context,
  sessionID: Session.ID,
): Effect.Effect<Standing | undefined> =>
  Effect.gen(function* () {
    const found = yield* Effect.result(ctx.session.get({ sessionID }));
    if (found._tag === "Failure") return undefined;
    if (found.success.projectID !== ctx.location.project.id) return undefined;

    const lost = found.success.location.directory;
    if (yield* Effect.promise(() => isDirectory(lost))) return undefined;

    const project = ctx.location.project.directory;
    const listing = yield* Effect.promise(() => listed(project));
    if (listing.kind === "no-repository") return nothing(sessionID, lost, listing.why);

    const rows = listing.rows;
    const main = mainOf(rows);
    if (main === undefined) return nothing(sessionID, lost, "git reports no worktree on main");

    const [prs, status, behind] = yield* Effect.all(
      [
        Effect.promise(async () => {
          const pulled = await pullRequests(main);
          return pulled.ok ? pulled.prs : [];
        }),
        Effect.promise(() => run(main, ["status", "--porcelain"])),
        Effect.promise(() => run(main, ["rev-list", "--count", "HEAD..origin/main"])),
      ],
      { concurrency: "unbounded" },
    );

    const branch = yield* Effect.promise(() => nameOf(rows, lost, main));
    const landing = yield* Effect.promise(() => landed(branch, main, prs));

    return {
      session: sessionID,
      where: { lost, onDisk: false },
      main: {
        kind: "found",
        directory: AbsolutePath.make(main),
        dirty: status.ran ? tracked(status.out) : { kind: "unknown" },
      },
      behind: answered(behind) ? count(behind.out) : undefined,
      branch,
      landing,
    };
  });
