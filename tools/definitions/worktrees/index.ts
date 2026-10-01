import type { Plugin } from "@opencode/plugin/effect";
import type { Tool } from "@opencode/schema/tool";
import { AbsolutePath } from "@opencode/schema/schema";
import type { Session } from "@opencode/schema/session";
import { Effect, Schema } from "effect";
import {
  BASES,
  BUCKETS,
  escort,
  type Reads,
  type Start as StartFacts,
  mismatch,
  refusal as policyRefusal,
} from "./classify";
import {
  attachBranch,
  bareOf,
  branchExists,
  currentBranch,
  firstResolving,
  head,
  hostRefusal,
  isWorktree,
  type ListedWorktree,
  listed,
  mainOf,
  rootFor,
  resolves,
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
    description: "Directory name and, unless `branch` says otherwise, the new branch name. Lowercase kebab-case, at most 40 characters.",
  }),
  branch: Schema.optional(Schema.String).annotate({
    description: "New branch name. Defaults to `name`.",
  }),
  base: Schema.optional(Schema.String).annotate({
    description: "Ref to branch from. Defaults to the first of origin/HEAD, origin/main, main, HEAD that resolves.",
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
  base: Schema.String,
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

const runStart = (ctx: Plugin.Context) =>
  Effect.fn("spectre.worktrees.start")(function* (
    input: typeof Start.Type,
    sessionID: Session.ID | undefined,
  ) {
    const projectDirectory = ctx.location.project.directory;
    const branch = input.branch ?? input.name;

    const listing = yield* Effect.promise(() => listed(projectDirectory));
    if (listing.kind === "no-repository") return rejected(listing.why);
    const rows = listing.rows;
    const bare = bareOf(rows);
    const root = rootFor(bare ?? projectDirectory);

    const [branchTaken, base, sessionDirectory] = yield* Effect.promise(async () => {
      const [exists, resolved, where] = await Promise.all([
        branchExists(projectDirectory, branch),
        input.base === undefined
          ? firstResolving(projectDirectory, BASES)
          : resolves(projectDirectory, input.base).then((ok) => (ok ? input.base : undefined)),
        Effect.runPromise(whereIs(ctx, sessionID)),
      ]);
      return [exists, resolved, where] as const;
    });

    const blocked = policyRefusal({
      name: input.name,
      branch,
      root,
      rows,
      branchExists: branchTaken,
      base,
      sessionDirectory,
    });
    if (blocked !== undefined) return rejected(blocked.why);

    const gotExpected = yield* Effect.promise(() => head(projectDirectory));
    if (gotExpected.kind !== "read")
      return rejected(`${projectDirectory} is not a git repository, or has no commit yet`);

    const made = yield* Effect.result(
      ctx.worktree.create({
        projectID: ctx.location.project.id,
        directory: root,
        name: input.name,
        branch: base!,
        // `from` is the only field that names the repository to cut from, and the host
        // falls back to the project row when it is absent. That row is the bare
        // repository in this layout, and the host finds a repository by walking up for
        // a `.git` entry, which a bare repository does not have
        // (`packages/core/src/git.ts` at v2.0.21). Naming the session's own worktree
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
    const attached = yield* Effect.promise(() => attachBranch(directory, branch));
    if (!attached.ran || attached.code !== 0)
      return {
        status: "unverified" as const,
        directory,
        problems: `created on a detached HEAD and could not branch to ${branch}: ${attached.err || (attached.ran ? attached.out : "")}. Left intact, and this session has not moved.`,
      };

    const [after, gotHead, gotBranch] = yield* Effect.promise(async () =>
      Promise.all([listed(projectDirectory), head(directory), currentBranch(directory)]),
    );

    const reads: Reads = {
      listed: after.kind === "listed" && after.rows.some((one) => one.directory === directory),
      head: gotHead.kind === "read" ? gotHead.value : undefined,
      expected: gotExpected.value,
      branch: gotBranch.kind === "read" ? gotBranch.value : undefined,
      wanted: branch,
    };
    const wrong = mismatch(reads);

    if (wrong !== undefined)
      return {
        status: "unverified" as const,
        directory,
        problems: `${wrong}. Left intact, and this session has not moved.`,
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
      branch,
      base: base!,
      head: gotHead.kind === "read" ? gotHead.value : gotHead.why,
    };
  });

/**
 * The caller out of the way, or the reason the removal is not happening at all. This is
 * a statement about the session rather than about the directory: the host's removal
 * deletes a path and leaves a session's own row alone, so the two have to be ordered by
 * whoever calls this, and the ordering is the whole fix.
 */
type Escorted =
  | { readonly kind: "clear" }
  | { readonly kind: "moved"; readonly to: string }
  | { readonly kind: "refused"; readonly problems: string };

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
 * What git can say about a directory before the host is asked to delete it: whether the
 * directory is there at all, whether git still lists it, and which branch it holds.
 * Three reads that do not depend on each other, so they are asked together.
 */
const runStanding = (directory: string, rows: ReadonlyArray<ListedWorktree>) =>
  Effect.gen(function* () {
    const [onDisk, named] = yield* Effect.all(
      [
        Effect.promise(() => isWorktree(directory)),
        Effect.promise(() => currentBranch(directory)),
      ],
      { concurrency: "unbounded" },
    );
    return {
      onDisk,
      listed: rows.some((one) => one.directory === directory),
      branch: named.kind === "read" && named.value !== "HEAD" ? named.value : undefined,
    };
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

    const removed = yield* Effect.result(
      ctx.worktree.remove({
        projectID: ctx.location.project.id,
        directory: AbsolutePath.make(input.directory),
        force: false,
      }),
    );

    if (removed._tag === "Failure") {
      const why = hostRefusal(removed.failure);
      return {
        status: "failed" as const,
        directory: input.directory,
        ...kept,
        problems: why.forceRequired
          ? `${why.message} Nothing was deleted — that refusal is the guard.`
          : `${why.message}`,
      };
    }

    return {
      status: "removed" as const,
      directory: input.directory,
      ...kept,
    };
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

const DESCRIPTION = `How a change reaches a worktree, what is in the way, and when one may go.

  await tools.spectre.worktrees({})                                    // survey
  const w = await tools.spectre.worktrees({ action: "start", name: "fix-login" })
  w.status === "opened"                                                // this session is now in it
  await tools.spectre.worktrees({ action: "remove", directory: w.directory })
                                                                   // and this one sends it back to main

## The buckets, and what each one licenses

- \`hold-wip\`. Tracked edits in the tree. Nothing may touch it.
- \`hold-unpushed\`. Git hosts no other copy: no remote-tracking ref for the branch.
  Removing the directory removes the work.
- \`safe\`. The work is already on \`origin/main\`. Deletion loses nothing the author
  was still holding.
- \`review\`. None of the above, and a remote copy exists. Read it before deciding.

The buckets are decided with the git CLI. \`gh\` is read for the \`pr\` column and
nothing else, because a pull request is a forge fact and the forge does not decide
what may be deleted. The cost is stated in the evidence, not hidden: an N-into-1
squash-merge rewrites the patch, so no git-only signal can see it, and a
squash-merged branch reads \`review\` and is kept. That errs toward keeping
directories, which is the direction that loses no work.

\`safe\` does not mean the work was good. It means the author let it go.

## Reading the evidence

- \`dirty\`: \`clean\`, \`wip:<n>\` for n tracked changes, \`scratch:<n>\` for n
  untracked files, or \`unknown\` when the read failed. Untracked files are not
  WIP, which is why they are counted separately: a build artefact left behind is
  not a reason to hold a worktree.
- \`remote\`: \`pushed\`, \`ahead:<n>\` commits not on origin, \`no-remote\`,
  \`detached\`, or \`unknown\`.
- \`pr\`: \`#<number>/<state>\` or \`-\`. States are OPEN, CLOSED, and MERGED. This
  column is information; no bucket reads it.
- \`ageDays\`: days since the HEAD commit, or -1 when the worktree has no commit.
- \`merged\`: HEAD is an ancestor of \`origin/main\`, or \`unknown\` when that ref
  does not resolve. \`unknown\` is not \`false\`.

**A failed read is never the reassuring value.** A \`git status\` that cannot run
reports \`unknown\`, not \`clean\`, and no bucket treats \`unknown\` as \`safe\`.

A survey does not fetch and does not measure disk size. \`merged\` is false for
every worktree when \`origin/main\` has not been fetched, and \`problems\` says so
rather than quietly reporting nothing merged. Fetch first when the answer decides
a deletion. A bad path or a directory that is not a repository comes back in
\`problems\` with an empty \`worktrees\`, never as a failed call. A worktree whose
directory was collected is named in \`problems\` rather than listed as a row,
because there is no tree to measure; \`git worktree prune\` clears it.

## Start is one call, and it moves you

\`start\` refuses unless the calling session is in the project's main worktree. It
creates the worktree, branches it off trunk, reads the result back, and **moves
this session into it**. There is no second call and nothing to remember: when it
returns \`opened\`, the session you are reading this in is the one working in the
worktree, and its subagents inherit that.

A session already in a worktree cannot open another — its directory is compared
against the worktree on \`main\` in the same reading. One worktree per session. A
fanning-out parent therefore stays on main and each worker starts its own; see
\`playbook-hillclimb\` and \`playbook-shipping\`.

## And remove is the trip back

Deleting a directory does not move the session standing in it, so \`remove\` reads this
session's own directory and, when it is the one being removed, moves to \`main\` **first**.
By the time \`removed\` returns this session is in \`main\`, and \`moved\` says so. A removal
of somebody else's worktree leaves you where you were. A failed move removes nothing, and
a repository with no worktree on \`main\` is \`rejected\` rather than performed — there would
be nowhere to send you.

## Where a worktree goes

Beside the repository, in a \`…-worktrees\` directory: \`~/dev/spectre-worktrees/\`
for a bare repository at \`~/dev/spectre\`, and the same shape beside an ordinary
checkout. A worktree belongs to the repository it was cut from — it shares that
repository's object store — and this is the layout the project already uses by
hand. Never inside a working tree: a nested worktree shows up in its own
checkout's status as an untracked directory, which would make a clean tree look
like it has WIP and could block its own cleanup.

## What \`status\` certifies

Only \`start\` and \`remove\` return a status; a survey returns rows and counts.
\`opened\` is the only status that says a worktree is ready, and it means three
reads agreed: git lists the directory, its HEAD is the commit the base resolved
to, and it is on the branch you asked for.

- \`opened\` — created, branched, read back, and the session moved in.
- \`unverified\` — it exists, and a read disagreed. Left intact on purpose: the
  directory is the evidence. Read \`problems\`, then remove it and try again.
  **The session was not moved.**
- \`rejected\` — nothing was created. \`problems\` says which rule.
- \`failed\` — a step errored. \`directory\` is present when something landed, and
  \`moved\` is present when the session had already been sent home before it failed.
  A failed \`start\` has no \`moved\`, which is how you read that its session stayed put.
- \`removed\` — the directory is gone. The branch was kept, and this session is in
  \`main\` when it was the one removed.
- \`already-gone\` — nothing to do. Removing twice is not an error.

## What it will not do

No \`force\`, and there is no input that produces one. A dirty or untracked
worktree is refused by git and comes back as \`failed\` with git's own message;
the tree is still there, which is the point. It never deletes a branch: removal
reclaims a directory, and a branch is somebody's work. It never removes the main
worktree. It never edits, commits, or pushes, and the one session it ever moves
is the one asking, which it only moves out of its own way.

A collected worktree is named in \`problems\` rather than listed as a row, because
there is no tree to measure: git keeps a \`prunable\` row for a directory that is
gone, and a row built from it would report itself clean. \`git worktree prune\`
clears it. A session left in such a directory returns itself to main on its next
prompt, which is not this tool's doing — it registers no action for it.`;

export const worktrees = (ctx: Plugin.Context): Tool.Info<typeof Input, typeof Output> => ({
  name: "worktrees",
  description: DESCRIPTION,
  input: Input,
  output: Output,
  options: { namespace: "spectre", codemode: true, pinned: true, permission: "worktree" },
  execute: (input, context) =>
    Effect.gen(function* () {
      if (input.action === "start") return { output: yield* runStart(ctx)(input, context?.sessionID) };
      if (input.action === "remove") return { output: yield* runRemove(ctx)(input, context?.sessionID) };

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
