# Playbook autopilot-full

One owner per pull request, each driven to merged, with a root verdict on every
round. Capacity is `subagent` with `background: true`, and every worker shares
this filesystem, so owner paths are disjoint by construction or two of them will
collide. Nothing runs while nobody is in the room, so the audit tick is a phase
you re-invoke.

## Start

State the plan when asked and stop: a request to state the protocol is not a go.
Execution starts on an explicit go, and it begins by writing the objective down.

1. Take the go, write the objective down
2. Mark the operator's items
3. Spawn one owner per pull request
4. Verify each round
5. Merge on a clean verdict
6. Run the audit tick
7. Stand down

## Phase A: Take the go, write the objective down

Resolve the forge once: `gh` by default, `origin` if it resolves the repository, and record
which one. Never require `gt`.

`/goal` held the objective; a file holds it now. Put it in `.spectre/autopilot.md` at the
project root, in a form a run that has never seen this conversation can act on: the queue
as it stands, each item's owner and state, the verification bar, and the exit condition.
That file is all a later run reads, so a row is written when it changes.

## Phase B: Mark the operator's items

Items the operator names stay with the operator. You do not build them, verify them, or let
an owner merge one: that owner's job stops at merge-ready and waits for the human's click.

## Phase C: Spawn one owner per pull request

One owner per PR owns the whole lifecycle: build, first push, a ready PR opened before
self-proof, the repo's own pre-review checks from its `AGENTS.md`, a review-comment sweep,
a rebase onto trunk, and its own merge.

Within roughly one run, every owner has started a `decisions.tsv` trail
(`show-me-your-work`), pushed its first branch snapshot, and opened the PR ready rather
than draft. Keep the trail uncommitted and return it with the report. Each owner also keeps
a `children.tsv`: subagent id, expected runtime, state, added when the subagent starts.

**What the missing isolation costs.** The source gave each owner a private machine, so
two owners could touch the same file and neither would know. Here they share one
filesystem, and the collision reads as a corrupted file rather than a scheduling bug, so
prevention is structural: one writer per branch, disjoint files, and sequenced work merged
before the dependent PR branches. Where two items genuinely overlap, run them in separate
runs.

Never stack here. Self-contained PRs branch off trunk; sequenced work is merge-then-branch.

## Phase D: Verify each round

A round starts at the owner's code-ready head SHA, and again at each later push that
changes the patch. At that SHA, fan out independent verifiers in one message with
`background: true`, one model per verifier from `tools.spectre.routing({})`, and aggregate
to one verdict. The lanes:

- Re-run the gates at that exact SHA.
- Prove the load-bearing behaviour on the real surface the change touches; a verdict
  without this lane is not clean.
- Audit the diff and distrust the pull request body.
- Run the same scenario against current trunk, and where trunk lacks the feature, record
  that fact and gate the behaviour the diff adds.

**Where the source watches, call and read.** It arms a loop around CI and merges;
`tools.spectre.stack({ prs: [218] })` returns once with a verdict and `rows` you can check.
`stack: "waiting"` means a check is still running, which is the source's sleep state, so
come back rather than intervene. `stack: "blocker"` names the PR to fix first. One call is
a reading of that moment, not a standing watch, so re-run it before acting on a clear.

Send every proven finding back to the owner in one fix-forward, with a red test requested
for every site carrying the same defect. A new head SHA starts a fresh round.

## Phase E: Merge on a clean verdict

The owner merges only from a head freshly rebased onto trunk, and only when the verdict
matches the merge-ready head. Squash-merge its own PR, then re-run
`tools.spectre.stack({})`, because the next PR's base just moved. It picks up its next
self-contained item in the same run and appends its row to `.spectre/autopilot.md` first.

The merge is the one step an owner may not take on babysitting alone. An operator's
autonomy grant plus a clean root verdict is the authorisation; neither substitutes for the
other.

## Phase F: Run the audit tick

The source runs this on a thirty-minute loop. You run it when you are next in the room, and
that version does not exist, so the cadence is the human's, not yours.

Re-read this file from trunk, then re-read the objective in `.spectre/autopilot.md`, and
audit the operation against both. Fix drift during that tick. Count only side effects as
progress: commits, pushes, PR or check deltas, and reports. An owner that passed its
expected runtime with no side effect is stuck; stand it down and dispatch a replacement at
once. A stall is never evidence the work is wrong, and never a reason to drop it.

The tick ends only when no delegated work is left, even after the last merge.

## Phase G: Stand down

The operator's hold is a zero-writes order that reaches every owner the moment it is
given. Owners hold their briefs until it is released, nothing is left mid-push, and the
state file is written last so the next run picks the queue up where it stood.

## Outputs

The queue with each PR's owner, state, and head SHA. Each verdict and the round that
produced it. What merged and what each owner took next, the open operator gates, and where
the `decisions.tsv` trails live.
