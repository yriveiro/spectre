# Playbook session-pickup

Take over work another session left in flight and resume it at the right point. The
prior work is authoritative input, not a hint.

The trail is git: branches, worktrees, the commit record, and what is on disk
right now. A commit records a decision that became code. Reasoning that never
became a commit is not in git, and where it is missing, say so rather than
infer it.

## Start

1. Find the work
2. Read what landed
3. Read what is on disk uncommitted
4. Name the resume point
5. Route the rest
6. Check the inherited claims

## Phase A: Find the work

Locate the in-flight work before reading anything.

- **A branch or a worktree.** `git worktree list`, `git branch -a --sort=-committerdate`,
  and for each candidate, how far it is from its base. `tools.spectre.worktrees({})`
  buckets every worktree by whether deleting it would lose work, which shows at a
  glance that a branch exists and whether its tree is dirty.
- **A commit range handed to you.** A base and a head.

If the handover names a branch, work on the branch, and do not read other people's
working directories.

Then orient: commit subjects newest first, then the bodies of the ones that explain
themselves. `tools.spectre.history({ path })` per touched file is worth one call
each, and its `contains` filter finds the commit that said why — "fix", "revert",
"for now", "temporary".

## Phase B: Read what landed

Establish what is already done, so you do not do it again. `git log` for the series,
then `git diff <base>...HEAD --stat` for the shape and the full diff for the content.
Read the full diff of at least the commits that changed behaviour: a subject is a
claim about the diff, and the claim is what you are deciding whether to trust.

Two things the diff tells you that a subject never does: whether the change is
complete or a first half of something, and whether the tree passes. Run the
project's checks on the branch as it stands before you change anything — a branch
that is already red is the most important thing to inherit and the easiest to miss.

## Phase C: Read what is on disk uncommitted

Uncommitted work is the part a transcript would have described best, and the part
you cannot reconstruct afterwards.

- In the worktree you joined: `git status`, then `git diff` and `git diff --staged`.
  Read it. It may be a half-finished change, or a complete one that was never
  committed.
- In other worktrees: `tools.spectre.worktrees({})` already reports which ones hold
  uncommitted work. Do not read a diff out of curiosity; read the ones the handover
  points at.

Also look for a resume note on disk. `playbook-pause-safely` writes one, and it is
the part of a transcript that survives here. `/tmp/<slug>-resume.md` from a previous
session may be gone; a note committed to the branch will not be.

## Phase D: Name the resume point

Compare what shipped against what was planned, and write down where you continue.
Three parts, in this order:

1. **What is done.** The commits that landed, as subjects with their shas.
2. **What is in flight.** The uncommitted changes, by file, and your read of whether
   they are complete or partial.
3. **What is next.** The first concrete action, named as an action.

The test is whether a reader could continue the work from your three parts alone. If
they could not, the gap is in the pickup, not in the handover.

The failure to avoid is a fresh verification pass over what the prior session already
verified. "Let me check from scratch" treats the inherited work as untrustworthy, and
it is how a pickup doubles a session's cost. Check what was not checked, not what
was. `principle-verification` owns the general form; here the unchecked claim is the
prior summary.

## Phase E: Route the rest

This procedure ends at the resume point. Hand the remaining work to whatever owns it:
`playbook-hillclimb` for a measured target with iterations left, a bug fix for one
defect, `tdd` for a change with untested behaviour.

Four verdicts exist for inherited work and they are different outcomes: continue the
execution, ship a finished recommendation, ratify or override a prior conclusion, or
write up a failed run. Decide which one this is, because "continue" is not the only
reading of a half-finished branch and picking the wrong one wastes the whole pickup.

## Phase F: Check the inherited claims

The prior session's summary is a claim, from a party with an interest in it being
right. Verify the load-bearing ones against the real artifact — run the tests, open
the page, execute the thing. A green report from another session is not a green
report. Start with the claims the resume point depends on, and any claim about
something visual, which a commit subject cannot carry at all.

## Outputs

- Where the prior session stopped, with the commit shas and the paths.
- What you inherited against what you redid. The honest answer is usually nothing
  redone, and saying so is part of the report.
- The resume point: done, in flight, next.
- Which inherited claims you checked, and what they said.
- The outcome, and where the remaining work was routed.
