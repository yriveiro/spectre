import type { Plugin, Tool } from "@opencode/plugin/effect";
import { Goal } from "@opencode/schema/goal";
import { AbsolutePath } from "@opencode/schema/schema";
import type { Session } from "@opencode/schema/session";
import { Effect, Schema } from "effect";
import {
  BASES,
  BUCKETS,
  branchState as branchStateOf,
  escort,
  isLedgerOnlyPorcelain,
  LEDGER_PATH,
  mismatch,
  refusal as policyRefusal,
  type Reads,
} from "./classify";
import {
  answered,
  attachBranch,
  bareOf,
  branchExists,
  commitOf,
  currentBranch,
  detachHead,
  firstResolving,
  head,
  hostRefusal,
  isWorktree,
  type ListedWorktree,
  listed,
  mainOf,
  resolves,
  rootFor,
  statusPorcelain,
  takeBranch,
  toplevel,
} from "./read";
import { audit, count } from "./survey";

const Bucket = Schema.Literals([...BUCKETS]);

export { update as sessionReturn } from "./return";

const List = Schema.Struct({
  action: Schema.optional(Schema.Literals(["list"])).annotate({
    description: "Survey the worktrees. The default when `action` is omitted.",
  }),
  repo: Schema.optional(Schema.String).annotate({
    description: "Repository to inspect. Defaults to the project directory.",
  }),
});

const Row = Schema.Struct({
  path: Schema.String,
  branch: Schema.String,
  head: Schema.String,
  ageDays: Schema.Number,
  merged: Schema.Union([Schema.Boolean, Schema.Literals(["unknown"])]).annotate({
    description: "`unknown` when origin/main does not resolve, which is not the same as false.",
  }),
  dirty: Schema.String,
  remote: Schema.String,
  pr: Schema.String,
  bucket: Bucket,
});

const Counts = Schema.Struct({
  "hold-wip": Schema.Number,
  "hold-unpushed": Schema.Number,
  safe: Schema.Number,
  review: Schema.Number,
});

export const Start = Schema.Struct({
  action: Schema.Literals(["start"]).annotate({
    description: "Open a worktree for this change and move this session into it.",
  }),
  name: Schema.String.annotate({
    description:
      "Directory name and, unless `branch` says otherwise, the new branch name. Lowercase kebab-case, at most 40 characters.",
  }),
  branch: Schema.optional(Schema.String).annotate({
    description:
      "Branch to put the worktree on. Defaults to `name`. A branch that already exists and that no worktree holds is picked up rather than refused, and the worktree is cut from it instead of from `base`.",
  }),
  base: Schema.optional(Schema.String).annotate({
    description:
      "Ref to branch from. Defaults to the first of origin/HEAD, origin/main, main, HEAD that resolves.",
  }),
  detached: Schema.optional(Schema.Boolean).annotate({
    description:
      "Open the worktree on a detached HEAD at `base` without creating or checking out a branch.",
  }),
});

export const Remove = Schema.Struct({
  action: Schema.Literals(["remove"]).annotate({
    description: "Remove one worktree. Never the main one, never with force.",
  }),
  directory: Schema.String.annotate({
    description: "Absolute path, exactly as a previous listing reported it.",
  }),
});

export const Action = Schema.Union([Start, Remove]);

export const Opened = Schema.Struct({
  status: Schema.Literals(["opened"]).annotate({
    description: "Created, branched, read back, and this session is now in it.",
  }),
  directory: Schema.String,
  branch: Schema.String,
  cut: Schema.String.annotate({
    description:
      "The ref the worktree was cut from. That is `base` for a new branch, and the branch itself when it was picked up.",
  }),
  head: Schema.String,
});

export const Unverified = Schema.Struct({
  status: Schema.Literals(["unverified"]),
  directory: Schema.String,
  problems: Schema.String.annotate({
    description: "Left intact, and this session has not moved.",
  }),
});

export const Rejected = Schema.Struct({
  status: Schema.Literals(["rejected"]),
  problems: Schema.String.annotate({ description: "Nothing was created." }),
});

/**
 * One field, one sentence, on both outcomes that can carry it. `start` never sets it,
 * because a start that reports a move is `opened`, and an `unverified` start is one
 * whose session was deliberately not moved.
 */
const MovedTo = Schema.optional(Schema.String).annotate({
  description: "Where this session was moved to, when this call moved it. Absent when it did not.",
});

export const Failed = Schema.Struct({
  status: Schema.Literals(["failed"]),
  problems: Schema.String,
  directory: Schema.optional(Schema.String).annotate({
    description: "Present when something landed on disk.",
  }),
  moved: MovedTo,
});

export const Removed = Schema.Struct({
  status: Schema.Literals(["removed"]),
  directory: Schema.String,
  branch: Schema.optional(Schema.String).annotate({
    description: "The branch that was kept.",
  }),
  moved: MovedTo,
});

export const AlreadyGone = Schema.Struct({
  status: Schema.Literals(["already-gone"]),
  directory: Schema.String,
  problems: Schema.optional(Schema.String),
});

const rejected = (problems: string) => ({ status: "rejected" as const, problems });

/**
 * The calling session's worktree top level, resolved by git rather than compared as a
 * string: the session's spelling and git's differ and mean one directory.
 *
 * `undefined` means the call carries no session, or the session could not be read. Both
 * are "this tool cannot place the caller", and each caller says so in its own terms —
 * `start` refuses, because a worktree nobody moves into is not a start.
 */
const whereIs = (ctx: Plugin.Context, sessionID: Session.ID | undefined) =>
  sessionID === undefined
    ? Effect.succeed(undefined)
    : Effect.result(ctx.session.get({ sessionID })).pipe(
        Effect.flatMap((found) =>
          found._tag === "Failure"
            ? Effect.succeed(undefined)
            : Effect.promise(() => toplevel(found.success.location.directory)),
        ),
      );

const prepareWorktree = async (
  directory: string,
  cut: string,
  branch: string,
  existing: boolean,
  detached: boolean,
): Promise<string | undefined> => {
  const attached = detached
    ? await detachHead(directory, cut)
    : existing
      ? await takeBranch(directory, branch)
      : await attachBranch(directory, branch, cut);
  if (attached.ran && attached.code === 0) return undefined;
  const detail = attached.err || (attached.ran ? attached.out : "");
  return detached
    ? `created worktree but could not detach HEAD at ${cut}: ${detail}. Left intact, and this session has not moved.`
    : `created on a detached HEAD and could not get onto ${branch}: ${detail}. Left intact, and this session has not moved.`;
};

const verifyWorktree = async (
  projectDirectory: string,
  directory: string,
  expected: string,
  branch: string,
  detached: boolean,
) => {
  const [after, gotHead, gotBranch] = await Promise.all([
    listed(projectDirectory),
    head(directory),
    currentBranch(directory),
  ]);
  const reads: Reads = {
    listed: after.kind === "listed" && after.rows.some((one) => one.directory === directory),
    head: gotHead.kind === "read" ? gotHead.value : undefined,
    expected,
    branch: gotBranch.kind === "read" ? gotBranch.value : undefined,
    wanted: detached ? "HEAD" : branch,
  };
  return {
    wrong: mismatch(reads),
    head: gotHead.kind === "read" ? gotHead.value : gotHead.why,
  };
};

const clearLedgerScratch = async (directory: string): Promise<Uint8Array | undefined> => {
  const treeStatus = await statusPorcelain(directory);
  if (!answered(treeStatus) || !isLedgerOnlyPorcelain(treeStatus.out)) return undefined;
  const file = Bun.file(`${directory}/${LEDGER_PATH}`);
  if (!(await file.exists())) return undefined;
  const saved = await file.bytes();
  await file.delete();
  return saved;
};

const runStart = (ctx: Plugin.Context) =>
  Effect.fn("spectre.worktrees.start")(function* (
    input: typeof Start.Type,
    sessionID: Session.ID | undefined,
  ) {
    const projectDirectory = ctx.location.project.directory;
    const detached = input.detached === true;
    const branch = input.branch ?? input.name;

    const listing = yield* Effect.promise(() => listed(projectDirectory));
    if (listing.kind === "no-repository") return rejected(listing.why);
    const rows = listing.rows;
    const bare = bareOf(rows);
    const root = rootFor(bare ?? projectDirectory);

    const [branchTaken, base, sessionDirectory] = yield* Effect.promise(async () => {
      const [exists, resolved, where] = await Promise.all([
        detached ? Promise.resolve(false) : branchExists(projectDirectory, branch),
        input.base === undefined
          ? firstResolving(projectDirectory, BASES)
          : resolves(projectDirectory, input.base).then((ok) => (ok ? input.base : undefined)),
        Effect.runPromise(whereIs(ctx, sessionID)),
      ]);
      return [exists, resolved, where] as const;
    });

    const state = detached ? { kind: "new" as const } : branchStateOf(branch, branchTaken, rows);

    const blocked = policyRefusal({
      name: input.name,
      branch,
      root,
      rows,
      branchState: state,
      base,
      requestedBase: input.base,
      sessionDirectory,
    });
    if (blocked !== undefined) return rejected(blocked.why);

    // A worktree is cut from the ref it is going to sit on, and that ref is the branch
    // when the branch is already there. Cutting a migration from `base` and switching to
    // the branch afterwards would work, and every read below would then be comparing the
    // branch's head against a commit that has nothing to do with it.
    const cut = state.kind === "existing" ? branch : base!;

    // The worktree is cut from `cut`, so `cut` is what its head has to equal.
    // Reading the calling checkout's HEAD instead reports a mismatch for every
    // worktree cut anywhere but HEAD, so a base one commit behind came back
    // `unverified` with the worktree perfectly correct.
    const gotExpected = yield* Effect.promise(() => commitOf(projectDirectory, cut));
    if (gotExpected.kind !== "read")
      return rejected(`${cut} does not resolve to a commit in ${projectDirectory}`);

    const made = yield* Effect.result(
      ctx.worktree.create({
        projectID: ctx.location.project.id,
        directory: root,
        name: input.name,
        branch: cut,
        // `from` is the only field that names the repository to cut from, and the host
        // falls back to the project row when it is absent. That row is the bare
        // repository in this layout, and the host finds a repository by walking up for
        // a `.git` entry, which a bare repository does not have
        // (`packages/core/src/git.ts` at v2.3.0). Naming the session's own worktree
        // gives it a `.git` file pointing back at the bare one, and for an ordinary
        // checkout this is the same path the fallback would have used.
        from: AbsolutePath.make(sessionDirectory!),
      }),
    );

    if (made._tag === "Failure") {
      // The host makes the parent directory before it creates anything and runs
      // the project's start command after the row is written, so a failure here
      // can still have landed a directory. Look before reporting nothing.
      const after = yield* Effect.promise(() => listed(projectDirectory));
      const landed =
        after.kind === "listed"
          ? after.rows.find((one) => one.directory.endsWith(`/${input.name}`))
          : undefined;
      return {
        status: "failed" as const,
        ...(landed === undefined ? {} : { directory: landed.directory }),
        problems: `the host failed to create the worktree: ${hostRefusal(made.failure).message}`,
      };
    }

    const directory = made.success.directory;
    const prepError = yield* Effect.promise(() =>
      prepareWorktree(directory, cut, branch, state.kind === "existing", detached),
    );
    if (prepError !== undefined)
      return {
        status: "unverified" as const,
        directory,
        problems: prepError,
      };

    const verified = yield* Effect.promise(() =>
      verifyWorktree(projectDirectory, directory, gotExpected.value, branch, detached),
    );
    if (verified.wrong !== undefined)
      return {
        status: "unverified" as const,
        directory,
        problems: `${verified.wrong}. Left intact, and this session has not moved.`,
      };

    if (sessionID !== undefined) {
      const moved = yield* Effect.result(ctx.session.move({ sessionID, directory }));
      if (moved._tag === "Failure")
        return {
          status: "unverified" as const,
          directory,
          problems: `the worktree is ready but this session could not move into it: ${String(moved.failure)}. Work in it explicitly rather than assuming the move happened.`,
        };
    }

    return {
      status: "opened" as const,
      directory,
      branch: detached ? "(detached)" : branch,
      cut,
      head: verified.head,
    };
  });

/**
 * The caller out of the way, or the reason the removal is not happening at all. This is
 * a statement about the session rather than about the directory: the host's removal
 * deletes a path and leaves a session's own row alone, so the two have to be ordered by
 * whoever calls this, and the ordering is the whole fix.
 */
const runEscort = (ctx: Plugin.Context) =>
  Effect.fn("spectre.worktrees.escort")(function* (
    sessionID: Session.ID | undefined,
    target: string,
    rows: ReadonlyArray<ListedWorktree>,
  ) {
    const plan = escort({ sessionDirectory: yield* whereIs(ctx, sessionID), target, rows });
    if (plan.kind === "nowhere") return { kind: "refused" as const, problems: plan.why };
    if (plan.kind === "stay" || sessionID === undefined) return { kind: "clear" as const };

    const moved = yield* Effect.result(
      ctx.session.move({ sessionID, directory: AbsolutePath.make(plan.to) }),
    );
    return moved._tag === "Failure"
      ? {
          kind: "refused" as const,
          problems: `this session is in ${target}, which is the directory being removed, and it could not be moved to ${plan.to}: ${String(moved.failure)}. Nothing was removed.`,
        }
      : { kind: "moved" as const, to: plan.to };
  });

/**
 * A session's live goal holds the worktree it was armed in. `remove` moves the
 * caller to `main` before deleting the directory, so a goal left active would
 * follow the session home and keep working on the wrong tree; a paused goal
 * would resume there later. The guard is about the caller only. A second
 * session's goal in the target is protected by the existing buckets.
 *
 * A session that cannot be read is not a session that is not in the target. The
 * read and the place both refuse rather than let the removal continue.
 */
const goalHolding = (ctx: Plugin.Context) =>
  Effect.fn("spectre.worktrees.goal")(function* (
    sessionID: Session.ID | undefined,
    target: string,
  ) {
    if (sessionID === undefined) return undefined;

    const session = yield* Effect.result(ctx.session.get({ sessionID }));
    if (session._tag === "Failure")
      return "This session could not be read, and a read that did not answer is not proof that it is not standing in the target. Run /goal to inspect it, then remove. Nothing was removed.";

    const where = yield* Effect.promise(() => toplevel(session.success.location.directory));
    if (where === undefined)
      return "This session's working directory could not be placed, and a place that did not answer is not proof that it is not the target. Run /goal to inspect it, then remove. Nothing was removed.";
    if (where !== target) return undefined;

    const read = yield* Effect.result(ctx.rpc(Goal.Definition).get({ sessionID }));
    if (read._tag === "Failure")
      return "This session's goal could not be read, and a read that did not answer is not proof that no goal is running. Run /goal to inspect it, then remove. Nothing was removed.";

    const goal = read.success;
    if (goal?.status === "active")
      return `This session's goal ${goal.id} is active in ${target}. Run /goal clear first: removing the worktree under a live goal would move the loop to main and lose the tree it was working in. Nothing was removed.`;
    if (goal?.status === "paused")
      return `This session's goal ${goal.id} is paused in ${target}. Run /goal resume to continue in this tree, or /goal clear to abandon the goal before removing it. Nothing was removed.`;
    return undefined;
  });

/**
 * What git can say about a directory before the host is asked to delete it: whether the
 * directory is there at all, whether git still lists it, and which branch it holds.
 * Three reads that do not depend on each other, so they are asked together.
 */
const runStanding = (directory: string, rows: ReadonlyArray<ListedWorktree>) =>
  Effect.gen(function* () {
    const [onDisk, named] = yield* Effect.all(
      [Effect.promise(() => isWorktree(directory)), Effect.promise(() => currentBranch(directory))],
      { concurrency: "unbounded" },
    );
    return {
      onDisk,
      listed: rows.some((one) => one.directory === directory),
      branch: named.kind === "read" && named.value !== "HEAD" ? named.value : undefined,
    };
  });

const removeDirectoryWithLedgerRollback = (
  ctx: Plugin.Context,
  directory: string,
  kept: { readonly branch?: string; readonly moved?: string },
) =>
  Effect.gen(function* () {
    const savedLedger = yield* Effect.promise(() => clearLedgerScratch(directory));
    const removed = yield* Effect.result(
      ctx.worktree.remove({
        projectID: ctx.location.project.id,
        directory: AbsolutePath.make(directory),
        force: false,
      }),
    );
    if (removed._tag === "Failure") {
      if (savedLedger !== undefined) {
        yield* Effect.promise(() => Bun.write(`${directory}/${LEDGER_PATH}`, savedLedger)).pipe(
          Effect.catchCause(() => Effect.void),
        );
      }
      const why = hostRefusal(removed.failure);
      return {
        status: "failed" as const,
        directory,
        ...kept,
        problems: why.forceRequired
          ? `${why.message} Nothing was deleted — that refusal is the guard.`
          : `${why.message}`,
      };
    }
    return { status: "removed" as const, directory, ...kept };
  });

const runRemove = (ctx: Plugin.Context) =>
  Effect.fn("spectre.worktrees.remove")(function* (
    input: typeof Remove.Type,
    sessionID: Session.ID | undefined,
  ) {
    const projectDirectory = ctx.location.project.directory;
    const listing = yield* Effect.promise(() => listed(projectDirectory));
    if (listing.kind === "no-repository") return rejected(listing.why);

    const rows = listing.rows;
    if (rows.length === 0)
      return rejected(`${projectDirectory} is not a git repository, or has no worktrees`);

    if (mainOf(rows) === input.directory)
      return rejected(`${input.directory} is the main worktree, and it is never removed here`);

    const standing = yield* runStanding(input.directory, rows);

    if (standing.onDisk) {
      const holding = yield* goalHolding(ctx)(sessionID, input.directory);
      if (holding !== undefined) return rejected(holding);
    }

    if (!standing.onDisk)
      return {
        status: "already-gone" as const,
        directory: input.directory,
        ...(standing.listed
          ? {
              problems: `${input.directory} is gone from disk but git still lists it; run \`git worktree prune\``,
            }
          : {}),
      };

    const escorted = yield* runEscort(ctx)(sessionID, input.directory, rows);
    if (escorted.kind === "refused") return rejected(escorted.problems);

    // One tail for both outcomes below: the branch that was kept, and this session's new
    // address when it had to move out of the way.
    const kept = {
      ...(standing.branch === undefined ? {} : { branch: standing.branch }),
      ...(escorted.kind === "moved" ? { moved: escorted.to } : {}),
    };

    return yield* removeDirectoryWithLedgerRollback(ctx, input.directory, kept);
  });

const Input = Schema.Union([List, Start, Remove]);

const Output = Schema.Union([
  Schema.Struct({
    worktrees: Schema.Array(Row),
    counts: Counts,
    problems: Schema.optional(Schema.String),
  }),
  Opened,
  Unverified,
  Rejected,
  Failed,
  Removed,
  AlreadyGone,
]);

const DESCRIPTION = `List, open, and remove git worktrees for isolated feature branches, session directory moves, and safe cleanup.
Default action "list" classifies worktrees into hold-wip, hold-unpushed, safe, and review buckets. Action "start" creates or attaches a branch worktree off main and moves this session into it, and "remove" escorts the session back to main before deleting clean directories without force.`;

export const worktrees = (ctx: Plugin.Context): Tool.Info<typeof Input, typeof Output> => ({
  name: "worktrees",
  description: DESCRIPTION,
  input: Input,
  output: Output,
  options: { namespace: "spectre", codemode: true, permission: "worktree" },
  execute: (input, context) =>
    Effect.gen(function* () {
      if (input.action === "start")
        return { output: yield* runStart(ctx)(input, context?.sessionID) };
      if (input.action === "remove")
        return { output: yield* runRemove(ctx)(input, context?.sessionID) };

      const report = yield* Effect.promise(() => audit(input.repo ?? ctx.location.directory));
      return {
        output: {
          worktrees: report.worktrees,
          counts: count(report.worktrees),
          ...(report.problems.length > 0 ? { problems: report.problems.join("\n") } : {}),
        },
      };
    }),
});
