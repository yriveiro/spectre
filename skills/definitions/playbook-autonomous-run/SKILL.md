# Playbook autonomous-run

A run does one unit of work and then stops. Nothing re-enters a session while you
are in it, so a run is a unit of work rather than a loop, and everything a later
run needs is written where that run will find it: the branch holds the work, the
commit body holds why the run advanced, and a file holds the objective.

## Start

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
`bun test` returns zero failures, the reproduction script no longer reproduces, these
seven pull requests are merged, the pixel diff is zero at `images/after/`. "The code is
better" is not a predicate.

Put the predicate and the exact command in `.spectre/run.md` in a form a run that has
never seen this conversation can act on: no pronouns, no "as discussed", no "the above".

## Phase B: Read the ledger, pick one unit

Read `.spectre/run.md` and the last few commit bodies on the branch. That file is the
only thing carrying the thread across sessions; the conversation is gone by the time
anyone comes back, and so is anything you remembered but never wrote down.

Pick exactly one unit: the smallest change the current evidence justifies, sized so its
own check is worth running. Sequence them so each one is verifiable on its own rather
than batching every check at the end (`principle-sequence-verifiable-units`).

A missing `.spectre/run.md` is not an emergency and not a licence to start over.
Reconstruct the predicate from the branch's commit bodies, write the reconstruction down
so it can be corrected, and proceed. Ask only if the predicate itself is ambiguous,
because guessing it means optimising the wrong thing for the rest of the run.

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

If the check needs an event to complete — CI finishing, a pull request merging, somebody
pushing a review — you cannot wait for it, because nothing here can wake you. Name that
event in the state file's next-check line and stop. The human, or the next session, is
the wake mechanism.

One watcher does exist, and it returns once rather than following: call
`tools.spectre.stack({})` where the source would arm one, and read the verdict. Where
the source watches a ref advance, read the branch instead of polling it.

## Phase E: Write the row down

Append one row per iteration to `.spectre/run.md`: what changed, whether the predicate
moved, the head SHA, the check output in one line. That is the ledger
`show-me-your-work` asks for, and a run that cannot be audited by a person who was not
here has not kept a trail.

Commit when the iteration advanced, with a body naming the hypothesis and what you
measured. Discard what did not help, and write that down too, so the next run does not
spend an iteration rediscovering it.

A plateau is not a stop. If the last two iterations moved the predicate by nothing,
change the approach rather than loosening the predicate. Never relax the predicate to
declare victory; the one honest way to stop early is a real dead end, and a dead end is a
finding to report rather than a failure to hide.

## Phase F: Stop and name the next check

The last thing the run does is write down the thing the source would have scheduled. One
sentence, in `.spectre/run.md`, naming the event or condition and the exact command that
would settle it: *"CI on `feat/queue` is still running; next run calls
`tools.spectre.stack({ prs: [218] })` and reads the verdict."*

Then stop. Coming back is a separate invocation and it is not yours to take.

## Outputs

`.spectre/run.md`, holding the exit condition, one row per iteration, and the next
check. One commit per unit that advanced, each with a body carrying the hypothesis and the
measured result. A closing message with the exit condition, the iterations run, what
landed, what was discarded, and the predicate's state now.
