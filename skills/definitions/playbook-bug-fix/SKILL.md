# Playbook Bug Fix

Own a defect from the first reproduction to a commit carrying the failing run and
the fix. Every shipped line traces to runtime evidence, and the smallest change
that evidence justifies is the one that goes in. A belt-and-suspenders change
that "might help" is a hypothesis, not a fix, and it does not ship. When
evidence refutes a hypothesis, revert whatever it motivated.

`tdd` owns the order of operations once a failing test exists: the run comes
first, before any production edit. This owns the shape of the whole task, and
that test is one phase of it rather than the whole of it. Load `tdd` for the
failing-test cadence, this for the hunt, the fix and the proof.

## Start

Open a `todolist` with one entry per phase before touching anything.

1. Reproduce
2. Bisect
3. Fix
4. Prove
5. Ship

## Phase A: Reproduce

Reproduce it yourself, on the surface the bug lives on, before anything else.
That includes the cases where a protocol would otherwise hand the step back to
the person who reported it. Ask them only after driving the local surface as far
as it goes, and only with a stated reason it cannot reach the target: a remote
service you cannot reach, hardware you do not have, a race that needs load.

If it will not fire directly, do not proceed as if it did. Synthesize the
trigger, tighten the conditions, lower the timeouts, drive the input that
triggers it, or instrument until it fires. An unreproduced bug is a description,
and every fix written against a description is a guess.

Keep the reproduction as a command or a script. Phase D needs to run it twice,
before and after, and paste the output both times.

## Phase B: Bisect

Form the candidate hypotheses, then rule them out until one survives. Seed them
with `how` over the affected subsystem and `why` for the regression history, and
`tools.spectre.history` for the line that changed when it started.

Each pass takes the split that cuts the most remaining problem space, gets
runtime evidence, and eliminates. A stack trace or error pasted into
`ripwire.from_trace` maps onto indexed symbols innermost-first, which turns a
frame list into a starting point instead of a reading exercise.

When program state is unclear, add instrumentation or logging and read it as
the
code runs. Do not guess at state from the source; the bug is the gap between what
the source says and what the state is.

Drive the passes yourself, or hand the hunt to a background `subagent` with one
written predicate per pass and have it write a note per elimination. Whichever you
pick, a long hunt is a written trail of what was excluded and why, not a session
of re-reading the same file.

Confirm the surviving mechanism with runtime evidence before Phase C. "The code
looks wrong" is not a mechanism.

## Phase C: Fix

Plan the fix before writing it, in one paragraph naming the mechanism and the
surface it has to hold. If the fix crosses a function boundary, run `architect`
first, because a boundary crossed by accident is a redesign by the back door.

Delegate the implementation to a `subagent` with a specific scope: the file
paths, the mechanism, the behaviour to hold, and what done looks like. Choose
the model with `tools.spectre.routing({})` — the judgement profile is the right
seat for a mechanism nobody has confirmed. No model id is written by hand
anywhere in this playbook; a hardcoded slug rots the day the allowlist moves.

Read the diff yourself before running anything.

## Phase D: Prove

Run the original reproduction on the same surface, and paste the failing output
and the passing output verbatim, in that order. "Inconclusive" is not a pass,
and running on a different surface than the one that reproduced is not a pass
either. Flag both rather than reporting around them.

Unit tests show branch behaviour, not the absence of the bug. Where the defect
has a cheap local test path, load `tdd` here: the failing run lands in git
before the fix, and the fix is the commit that turns it green. Where the test
would be expensive, integration-heavy or unclear, say which of those it was. A
skipped step with a stated reason is a decision; a skipped step with no reason is
a hole.

## Phase E: Ship

Stage the commits so the failing reproduction lands before the fix. Two commits
read as a story; one commit asks the reviewer to trust you on both halves at
once.

Order the branch with `tools.spectre.stack`, and open the pull request with
`gh pr create`. Say what was broken, the root cause, the fix, and how you
verified it.

## Outputs

What was broken, the root cause, the fix, and the failing-then-passing output of
the reproduction, verbatim. Plus the hypotheses you excluded and the evidence
that ruled them out, which is the part a reviewer cannot reconstruct.
