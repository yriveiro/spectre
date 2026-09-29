# Playbook autopilot-stack

As `playbook-autopilot-full`, but every item builds and verifies rather than
merges: the chain is handed to a person who lands it. Capacity is `subagent` with
`background: true` and every worker shares this filesystem, so owner paths are disjoint by construction.

## Start

State the plan when asked and stop; a request to state the protocol is not a go. On an
explicit go, the run begins by writing the objective down.

1. Take the go, write the objective down
2. Spawn one owner per pull request
3. Verify each round
4. Append on a clean verdict
5. Absorb drift at the root
6. Deliver the chain

## Phase A: Take the go, write the objective down

Resolve the forge once: `gh` by default, `origin` if it resolves the repository, and record
which one. Never require `gt`, and never register the chain through it — the chain is read
in plain git, with `git branch --list --format='%(refname:short) %(objectname)'` for the
members and `git merge-base --is-ancestor <parent> <child>` for the order.

Put the objective in `.spectre/autopilot-stack.md`
at the project root: the chain in order, each member's branch, base, head SHA, and
verdict, plus the exit condition. A later run reads that file and nothing else, so a row is
written on append.

## Phase B: Spawn one owner per pull request

One owner per PR owns its change end to end: build, first push, a ready PR opened before
self-proof, the repo's own pre-review checks from its `AGENTS.md`, a review-comment sweep,
a rebase onto trunk, and green checks. Within roughly one run every owner has started a
`decisions.tsv` trail (`show-me-your-work`), pushed its first branch snapshot, and opened
the PR ready rather than draft. The trail stays uncommitted and comes back with the report.
Each owner also keeps a `children.tsv`: subagent id, expected runtime, state.

**Keep owner paths disjoint.** Every worker shares one filesystem, and the collision reads as a corrupted file rather than a scheduling bug. So:
one writer per branch, disjoint files, and owners parallelised only across work that
touches different lines. Items that overlap run in separate runs.

An owner reports its code-ready head SHA once the shipped code is final, and STACK-READY with
the exact head SHA when its checks are green. It never merges, never arms auto-merge, and
never closes.

## Phase C: Verify each round

A round starts at the owner's code-ready head SHA and again at each later push that
changes the patch. At that SHA, fan out independent verifiers in one message with
`background: true`, one model per verifier from `tools.spectre.routing({})`, and aggregate
to one verdict. The lanes: re-run the gates at that SHA, prove the load-bearing behaviour
on the real surface the change touches, audit the diff and distrust the pull request body,
and run the same scenario against trunk — where trunk lacks the feature, record that fact
and gate the behaviour the diff adds rather than pretending trunk can produce it.

**Call and read.** `tools.spectre.stack({ prs: [221] })` returns once with a verdict and the `rows` behind it. `"waiting"` means a check is still running; come back later, not to intervene. `"blocker"` names the one to fix first. Nothing enters the stack unverified.

Every proven finding goes back to the owner in one fix-forward, with a red test for every
site carrying it. A new head SHA starts a fresh round.

## Phase D: Append on a clean verdict

The root is the only topology writer. Owners push only their own branches and report the
tip, the current base, and the intended parent. To append a PR: fetch the intended parent,
rebase the child branch onto that exact parent tip, push with `--force-with-lease` only
after an `ls-remote` check, then set the PR base with `gh pr edit <pr> --base
<parent-branch>`. Only the root PR targets trunk. Append in verified order, or in an order
the operator specified, and write the member's row into `.spectre/autopilot-stack.md` in
the same step.

## Phase E: Absorb drift at the root

Fetch current trunk and rebase the chain bottom to top. A rebase rewrites every SHA above
it and voids the verdicts recorded at the old ones, so re-check `tools.spectre.stack({ prs:
[…the chain…] })` after every rewritten push even where the patch is unchanged — the same
patch can still fail to merge.

When a rebase surfaces a conflict in an owner's files, that owner fixes its own slice in a
fresh run and the root pushes the result. Anything no longer verified goes back through
Phase C before it ships.

## Phase F: Deliver the chain

The deliverable is one linear chain of verified pull requests, reviewable bottom-up in the
forge, every link carrying its verdict in the PR body or a comment. The operator reviews
and lands it, with their own clicks.

Run the audit tick when you are next in the room, re-read this file from trunk and the objective in
`.spectre/autopilot-stack.md`, and probe every owner. Count only side effects as progress —
commits, pushes, PR or check deltas, reports — and treat an owner that passed its expected
runtime with none of those as stuck. The operator's stop is a zero-writes order.

## Outputs

Links to the chain's root and its tip, a one-line verdict per link, and anything parked or
excluded with the reason. The chain is not landed here, and the handoff says so.
