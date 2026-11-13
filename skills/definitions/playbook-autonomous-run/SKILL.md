# Playbook autonomous-run

A run drives one task to a checkable exit. Under `/drive`, the built-in goal
loop re-enters this session when it would go idle, so the run iterates until its
predicate is met. Without a goal the run is one unit and stops. Either way,
everything a later round or a later session needs lands where it will find it:
the branch holds the work, the commit body holds why the round advanced, and
`.spectre/run.md` holds the objective and the ledger.

## Goal mode

`/drive` arms a goal through `tools.spectre.goal`. The goal carries the
objective, the measured worktree and branch, the exit predicate, the exact check
and the ledger path. When a goal is active:

- The loop re-enters this session after every turn. Do one unit per turn and end
  the turn. Do not try to finish the whole run in one turn.
- The reviewer trusts only evidence in the conversation. Run the check and quote
  its output before you end the turn.
- On `continue`, read the reviewer's `reason` and `next_step` and take the next
  unit. Do not repeat work the ledger records as complete.
- On `blocked`, write the exact ask in `.spectre/run.md` and stop.
- The round number is the `rounds` field from
  `tools.spectre.goal({ action: "status" })`. The kickoff is round 0; the first
  continuation is round 1.
- A pause is `/goal pause`, typed by the user. Resume is `/goal resume`. The goal
  id is a handle only for the session that armed it.

## Native tools

Use the host's tools where they exist. `todowrite` holds the phase list when the host exposes it. `question`
asks a decision only the user can make. `shell({ background: true })` starts a wait
the goal can see. `tools.opencode.schedule_create` and its siblings start a wait no goal is holding.
`read` takes a negative `offset` to read a log's tail. The Spectre tools stay where they
enforce a rule: `tools.spectre.worktrees` combines the host's worktree create and session
move and verifies the result, `tools.spectre.stack` reads the PR state,
`tools.spectre.history` reads commits, and `tools.spectre.goal` owns the objective
contract.

## Start

Call `todowrite` with one entry per phase when the host exposes it (`experimental.todo` on a released build).

Three places hold a run's state, and this playbook uses all three because no single one
survives everything. The **branch** holds the work, and `tools.spectre.worktrees({})` is
how a later run finds it. The **commit body** holds why the run advanced, so a deleted
file still leaves a trail git can answer with `tools.spectre.history`. The **file**
`.spectre/run.md` at the project root holds the exit condition, the iteration log, and
the next check, in prose a person can read. Leave it uncommitted unless the repository
already tracks a `.spectre/` directory, and write it before the first unit rather than
after. Read it at the top of every run, before anything else.

1. Name the exit condition
2. Read the ledger, pick one unit
3. Change one thing
4. Check it against the condition
5. Write the row down
6. Stop and name the next check

## Phase A: Name the exit condition

Write the predicate before the first unit, not after the third failure. It has to be
something that can come out false, and it has to name the check that evaluates it:
`bun test` returns zero failures, the reproduction script no longer reproduces, `gh pr list`
reports these seven pull requests as merged, the pixel diff is zero at `images/after/`. "The
code is better" is not a predicate.

Put the predicate and the exact command in `.spectre/run.md` in a form a run that has
never seen this conversation can act on: no pronouns, no "as discussed", no "the above".

## Phase B: Read the ledger, pick one unit

Read `.spectre/run.md` and the last few commit bodies on the branch. That file is the
only thing carrying the thread across sessions. The conversation is gone by the time
anyone comes back, and so is anything you remembered but never wrote down.

Pick exactly one unit: the smallest change the current evidence justifies, sized so its
own check is worth running. Sequence them so each one is verifiable on its own rather
than batching every check at the end (`principle-sequence-verifiable-units`).

A missing `.spectre/run.md` is not an emergency and not a licence to start over.
Reconstruct the predicate from the branch's commit bodies, write the reconstruction down
so it can be corrected, and proceed. When the predicate itself is ambiguous, call
`question` with the options, because guessing it means optimising the wrong thing for
the rest of the run.

## Phase C: Change one thing

Make the smallest change the evidence justifies, and make it on the branch. A change
that might help gets reverted, not left to ride: a half-kept attempt is the hardest
thing for the next run to reason about, because it looks deliberate.

Mid-run discoveries are yours. A broken check, a flaky verifier, a broken skill in your
path, a failing tool call that a retry fixes — address them rather than parking them for
the human. Keep them in their own commit so a later reader can separate the side fix from
the unit it interrupted, then return to the predicate.

## Phase D: Check against the condition

Run the check named in Phase A, on the real artifact. Not a self-report, not a pre-commit
hook that passed, not a worker's summary. When something passes suspiciously easily,
suspect the measurement before the system.

A round that changed a code file owes the two ripwire measurements too. Run
`ripwire . --quality-delta` and `ripwire . --affected=PATH` on the tree after the
last code edit, and quote both outputs. A round that changed no file skips both.

If the check needs an event to complete — CI finishing, a pull request merging, somebody
pushing a review — do not sleep and do not poll in a loop. Under a goal, start the wait
with the native shell tool:

```js
await shell({ command: "gh pr checks <pr> --watch", background: true })
```

Say which event it waits for, and end the turn. The goal's reviewer may answer `wait`,
and the shell's completion wakes the session. Without a goal, and with
`experimental.schedules` on, create a one-shot native schedule:

```js
await tools.opencode.schedule_create({
  until: {
    run: "gh pr checks <pr> --json bucket --jq '[.[] | select(.bucket == \"pending\")] | length' || true",
    is: "0",
  },
  prompt: "The event is over. Re-read .spectre/run.md and take the next unit.",
})
```

It polls with no model call and wakes this session once. Without schedules, name the
event in the state file's next-check line and stop. The human, or the next session, is
the wake mechanism.

One watcher does exist, and it returns once rather than following: call `tools.spectre.stack({})` and read the verdict. Where a ref advances, read the branch instead of polling it.

## Phase E: Write the row down

Append one row per round to `.spectre/run.md`: the round number, what changed, the check
output in one line, whether the predicate moved, and the head SHA. A round that changed a
code file also carries both measurement outputs in its row. That is the ledger
`show-me-your-work` asks for, and a run that cannot be audited by a person who was not
here has not kept a trail.

Commit when the iteration advanced, with a body naming the hypothesis and what you
measured. Discard what did not help, and write that down too, so the next run does not
spend an iteration rediscovering it.

A plateau is not a stop. If the last two iterations moved the predicate by nothing,
change the approach rather than loosening the predicate. Never relax the predicate to
declare victory. The one honest way to stop early is a real dead end, and a dead end is a
finding to report rather than a failure to hide.

## Phase F: Stop and name the next check

The last thing the round does is write the next row and name the next check. One
sentence, in `.spectre/run.md`, naming the event or condition and the exact command that
would settle it. *"CI on `feat/queue` is still running. Next round calls
`tools.spectre.stack({ prs: [218] })` and reads the verdict."*

Under a goal, end the turn. The loop re-enters you, and the reviewer answers `done` only
when the evidence shows the predicate. Without a goal, stop: coming back is a separate
invocation and it is not yours to take.

## Scripted runs

`opencode run` sends a prompt, not a command, so it cannot run `/drive`. Start a
scripted run with `opencode run -w` on 2.2.6 or later, or `--worktree=<name>` to name
the tree. The native flag creates the worktree and starts the session in it. Then
follow this playbook's one-unit path. Do not run `git worktree add`.

## Outputs

`.spectre/run.md`, holding the goal id when there is one, the exit condition, one row per
round, and the next check. One commit per unit that advanced, each with a body carrying
the hypothesis and the measured result. A closing message with the exit condition, the
iterations run, what landed, what you discarded, and the predicate's state now.
