# Session return

Status: built, and **not yet verified by a live session**. The code is
`tools/definitions/worktrees/return/`; it registers no tool and is called by
`tools/index.ts`.

## Goal

`tools.spectre.worktrees({ action: "start" })` moves the calling session into a
worktree and leaves it there. When the branch merges on the remote and something
deletes that directory — a cleanup run, a person, a script, an editor — the
session is left pointing at a path that does not exist, and it keeps working.

The session must end up in the project's main worktree, and it must be told
what happened to the work it was standing on.

**Updating main is the user's call.** Nothing here fetches, fast-forwards, or
otherwise advances the trunk. The feature reports the distance and says so.

## Mechanism

Four properties of OpenCode 2.0.26 decide the shape. All read at the tag.
sources in the appendix.

1. **A plugin cannot enumerate sessions.** `ctx.session` is a `Pick` over
   thirteen members of `SessionApi` and `list` is not one of them. So nothing
   here can name a stranded session, and any design that tries is not hard, it is
   impossible. The only session identities available are the ones a hook is
   handed and the ones already held.
2. **A hook is handed the session it fires for.** Both `session.hook("prompt")`
   and `tool.hook("execute.before")` carry `sessionID`, so a session can be found
   at the moment it acts on itself.
3. **Moving out of a deleted directory is supported.** `SessionMove` validates
   the *destination* and fails loudly if it is gone. For the *source* it has a
   first-class path, publishing `SessionEvent.Moved` directly instead of going
   through the inbox and the runner.
4. **Nothing announces a worktree removal.** `worktree.updated` carries
   `projectID` and nothing else, so a subscription cannot learn which directory
   died. A directory is only ever discovered by looking at it.

(1) and (4) together are why this is pull-based. Nobody detects the deletion.
Each session checks its own directory, at the moments it can be hurt.

## The two channels

Both run one `rescue`, so the move logic exists once.

| Channel | Fires | Says itself by |
| ------- | ----- | --------------- |
| `session.hook("prompt")` | the session is spoken to | prepending to `prompt.text` |
| `tool.hook("execute.before")` | any tool call, host tools included | rejecting that one call with a `Tool.Error` |

The prompt channel is free and is seen before the next generation. The tool
channel exists for the case a prompt cannot cover: a directory collected
*mid-turn*, where the session is already working and will not be spoken to for a
while. One loud failed call beats a silent context swap, and the call after it
runs on main.

**That rejection is `Effect.catchDefect`, not `Effect.catchCause`.** Measured on
`effect@4.0.0-rc.112`: `catchCause` takes the whole `Cause`, a typed `Tool.Error`
included, so it swallows the rejection this channel exists to raise and the tool
call proceeds against a directory that is gone. `catchDefect` lets the typed
failure through and still swallows a measurement that blew up, which is the only
thing that must not become a rejected call.

`SessionPrompt.prompt` is `DeepMutable`, so the line is written in place. A tool
hook may fail with `Tool.Error` and nothing wider.

## What the session reads

Four lines, one per state. The rule across all of them: name the branch when
there is one, because a named branch is the difference between a session that can
go and get its work and one that cannot, and never say the work is safe when the
evidence did not say so.

```
This session was working in …/fix-login, which no longer exists. It moved to
…/spectre. Branch fix-login is on main.
```

```
This session was working in …/fix-login, which no longer exists. It moved to
…/spectre. Branch fix-login is NOT on main: 4 commits on it are not in main.
Do not assume the work you were doing is here.
```

```
This session was working in …/fix-login, which no longer exists. It moved to
…/spectre, which was not advanced: main has 2 tracked changes. Updating main is
your call; this is what is there now. Branch fix-login is on main.
```

```
This session was working in …/fix-login, which no longer exists, and this
repository has no worktree on main. The session was not moved.
```

The move is unconditional once the directory is gone. The alternative is a
session standing in a directory that does not exist, and no reading of the merge
evidence improves that, so the evidence decides only how loudly the line speaks.

## The decision

`home.ts` is pure: measured evidence in, one of four outcomes out, and the
sentence is a second pure function of the same input.

| Outcome | When |
| ------- | ---- |
| `left-alone` | the directory is still there. The overwhelming majority, and it says nothing. |
| `went-home` | stranded, main found, work on main, main clean and current. |
| `went-home-caught-short` | stranded and moved, but the work is not confirmed there, or main could not be advanced. |
| `held` | stranded and no worktree on main. Nothing to move to, so nothing is guessed. |

Three sums keep a `boolean` from flattening states that need opposite answers:
`Branch` (`named-by-git` / `recovered-from-path` / `unrecoverable`) records which
source named the branch, because after `git worktree prune` the row is gone and
the only fallback is the directory basename, which is the branch name only
because `start` defaults `branch` to `name`. `Landing` (`on-main` / `not-on-main`
/ `unknown`) answers "what do I tell a session with no directory", which is a
different question from `classify.bucket`'s "may this directory be deleted" —
`bucket` reads `dirty` and treats a failed read as `clean`, and `dirty` is not
measurable at all here. `prFor` is imported. `bucket` is not.

`behind: number | undefined` earns its optional: `undefined` means
`origin/main` is unknown, which is a different fact from `0`.

## Two traps, both measured on this machine

**`Bun.file(dir).exists()` is `false` for a directory.** Correct — a directory
is not a file — and it is the obvious way to ask whether a worktree still exists,
so it answers the wrong question in a way that looks right.
`await Bun.file(p).stat().isDirectory()` is the probe: `true` for a directory,
and it throws `ENOENT` for a path that is not there, so the throw *is* the
stranded signal and no separate existence check is needed. No `node:fs` import
and no AGENTS.md exception row.

**Position 0 of `git worktree list --porcelain` is not main.** On a bare-backed
project the bare repository is listed first and carries no branch, and the host
classifies position 0 as the main worktree. Measured here: position 0 is
`…/spectre` (bare), while the real main worktree is `…/spectre-worktrees/main`.
So `ctx.location.project.canonical` does not name a movable destination on this
repo's own layout, and `mainOf` finds the row whose branch is `main` instead.
`audit.ts` already had to learn this once.

## What it will not do

- **No fetch, no fast-forward, no merge.** `behind` and `dirty` are reported.
- **No branch deletion, no directory deletion, no worktree removal.** That is
  `action: "remove"`, and it keeps its own guards.
- **No enumeration, and no register.** A session nobody talks to and that makes
  no tool call stays where it is. Nothing can observe that it is doing nothing.
- **No tool, and no input.** The `worktrees` catalogue is unchanged: `remove`
  takes no new input, and every existing status means what it meant. `removed`
  and `failed` can now also carry `moved`, naming where the calling session went
  when it was standing in the directory being removed.

## What `remove` got instead

This hook is a rescue, and a rescue is the wrong shape for the common case. A
session that removes its own worktree used to be left pointing at a deleted
path, so the next tool call failed on a cwd that was not there and *this* hook
was what brought it home — a failed call and a re-issued intent to pay for a
deletion that had already succeeded.

`action: "remove"` now reads the calling session's directory and moves it to
`main` before asking the host to delete anything. The host's removal reclaims a
path and its row and nothing else (`packages/core/src/worktree.ts` at v2.0.26),
so the ordering has to live here. The hook still owns what `remove` does not: a
directory deleted behind the tool's back, or one removed while no session was in
it, still lands the session on the next prompt.

## Modules

Siblings inside the worktrees definition, which AGENTS.md sanctions for a
definition that outgrows one file.

| Module | Owns |
| ------ | ---- |
| `return/index.ts` | The two hook registrations and the shared `rescue`. |
| `return/standing.ts` | The only impure file. `ask` — the gate, then git. |
| `return/home.ts` | `home`, `say`. No host type, no git, no `node:*`. |

`home.ts` has a test against literal `Standing` values and needs no host, no
repository and no running session.

## Two bugs this fixed on the way

Neither was asked for. Both sat in this feature's path.

- **`tools.spectre.worktrees({})` threw `ENOENT`** on any repository holding a
  collected worktree. `Bun.spawn` throws from `posix_spawn` for a missing `cwd`
  rather than exiting non-zero, and `audit` spawns inside each worktree's own
  directory. The default action — the first line of `worktree-cleanup` — failed
  in exactly the state this feature is about. A missing directory is now a
  result, and a collected worktree is named in `problems` rather than reported as
  a row that reads `clean`.
- **`remove`'s `already-gone` status was unreachable** for an externally deleted
  directory, because `isWorktree` threw before the check could run. Same fix.

`Result` is a discriminated union, and the discriminator is load-bearing: `out` and
`code` are on the `ran: true` arm only, so a directory that is not there cannot be
read as an empty or failed repository. Nineteen sites read one of those fields
without narrowing, and every one of them was relying on `-1 !== 0` or on `""`
being falsy. `git()` having a different shape from what its callers want is the
point of the boundary.

`listed()` is a sum for the same reason one level up: an empty list is also what
a repository with no worktrees looks like, and "that directory is gone" must not
read as a fact about the repository.

## Open questions

1. **Does `ctx.session.get` re-enter a lock that `prepare` holds?** Unverified,
   and it is the reason this is not verified by a live session. The same callback
   calls `ctx.session.move`, which takes the inbox lock. If either deadlocks, the
   tool channel catches it, because that path is registered. Measure with one
   hook that calls `get` and one that calls `move`, against a real session, with
   a timeout.
2. **Do subagent prompts and synthetic deliveries reach `prepare`?** If they do,
   each child detects and moves independently, which is idempotent, and the
   transcript gets one line per child.
3. **`resolveDestination` calls `projects.resolve` on every move.** Whether the
   moved session joins the existing main project or creates a second row is host
   behaviour that predates this change.
4. **A failed move repeats the line every turn.** `held` and a refused move never
   reach a terminal state, so the same sentence recurs. That is honest, not
   bounded, and no bound should be claimed for it.

## Appendix: sources

Read at tag `v2.0.26`. A path that does not exist at that tag is not evidence
for anything in this file. The rule for reading the source is in `AGENTS.md`.

| Claim | Where, at the tag |
| ----- | ----------------- |
| `ctx.session` has no `list` | `packages/plugin/src/effect/session.ts:153` |
| `SessionPrompt.prompt` is mutable | `packages/plugin/src/effect/session.ts:17` |
| the prompt hook fires | `packages/core/src/session/prompt.ts:40` |
| session hooks cannot fail | `packages/core/src/plugin/hooks.ts:26` |
| `move` validates the destination | `packages/core/src/session/move.ts:74-83` |
| a vanished source is a supported path | `packages/core/src/session/move.ts:103-105`, `:138` |
| `execute.before` carries `sessionID`, for every tool | `packages/core/src/tool.ts:103-107`, `:241`, `:271` |
| only `Tool.Error` may fail that hook | `packages/plugin/src/effect/tool.ts:48-50` |
| position 0 is classed as main by the host | `packages/core/src/git.ts:691` |
| `canonical` is derived from that position | `packages/core/src/project.ts:350-356` |
| `worktree.updated` names no directory | `packages/schema/src/worktree.ts:56-59` |

Probed at runtime on Bun 1.4.2:

- `Bun.file(dir).exists()` is `false`.
- `Bun.file(p).stat().isDirectory()` is `true` for a directory and throws
  `ENOENT` for a missing path.
- `Bun.spawn` with a missing `cwd` throws `ENOENT` from `posix_spawn`.
- A collected worktree leaves a `prunable` row carrying its branch and HEAD, and
  `git worktree prune` removes the row while the ref survives.
- On a bare-backed project the bare entry is listed first.
