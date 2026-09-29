# Playbook shipping

Land a stack of pull requests, one at a time, from the bottom up. Verify each
pull request independently, land only the verified run from the root, then keep
your hands off the queue. This is the half after `playbook-babysit`.

## The verdict

`tools.spectre.stack({})` computes the verdict as a pure function of the pull
request state and returns in one call. Call it, act, and call it again rather
than waiting on it:

```
const s = await tools.spectre.stack({ prs: [412] })
s.stack      // "blocker" | "waiting" | "clear"
s.blocker    // which PR is stopping this one
s.rows       // per-PR evidence: mergeable, CI, threads, decision
s.problems   // PRs gh could not read
```

**The polling is your job.** A watcher that ran an hour would give a different
answer to the same question for reasons that had nothing to do with the pull
request. This cannot: same state, same answer. Call it, read `rows` for the
bottom pull request, and if it is `waiting` say which check you are running on
and stop. No sleeping, no holding the session open.

## Start

Open a `todolist` with one entry per phase before you merge anything.

1. Verify each pull request
2. Find the ceiling
3. Check the verdict still describes the patch
4. Prepare the bottom
5. Land one
6. Recompute
7. Report

## Phase A: Verify each pull request

One verifier per pull request, not batched. Each is a subagent on a model you
pick with `tools.spectre.routing({})`, each exercising the real surface against
parent versus head, and each returning `PASS`, `PASS+NOTES` or `FAIL` and
posting that verdict on its own pull request. Give each its own worktree:
verifiers sharing a working directory serialize on it and the fan-out is a lie.

Safe means a verdict from an agent that did not write the code. A green CI run
is not a verdict, and an approving bot review is not a verdict. If the only
evidence on a pull request is its own checks, it is unverified and this phase
has not happened.

## Phase B: Find the ceiling

Walk up from the lowest unmerged pull request and stop at the first one without
a passing verdict, counting `PASS` and `PASS+NOTES` as passing. A verified pull
request above an unverified one is not landable: it depends on something nobody
has looked at. Report the ceiling as a pull request number and say what breaks
the chain.

## Phase C: Check the verdict still describes the patch

A verdict is a claim about a specific diff, and a rebase or a base retarget
rewrites the SHAs it was taken at without touching a check. Record, per pull
request, the verdict head SHA, the base SHA, and the stable `git patch-id` of
its base-to-head diff, then compare that against the current one before landing.

- **Identical.** The verdict still describes the patch. Re-run mergeability and
  CI at the current head and keep it.
- **Different, in the code.** The verdict is void. Re-verify.
- **Different, only in tests, docs or lint config.** Judge the difference, not
  the file list. Build the lane twice at the verdict SHA and once at the current
  head: a difference that also shows between the two builds at the verdict SHA
  is noise, as is an embedded commit SHA. Report each kind of noise and its
  files. If only noise differs, that lane's result stands and checks run fresh.

Never reuse a lane result from a dev server or anything else with no build
output, and never substitute a matching commit message or a green check from an
older SHA.

## Phase D: Prepare the bottom

Prepare one pull request at a time, and only the bottom one. Fetch trunk, rebase
the lowest verified branch onto the exact trunk tip when it needs it, push with
`--force-with-lease`, and retarget only that pull request with
`gh pr edit <pr> --base <trunk>`. Re-run Phase C after the push, because the
push moved the SHA the verdict was taken at. Do not retarget, arm, or merge
descendants yet.

## Phase E: Land one

**Only an explicit ask to land or ship authorizes a merge here.** If the bottom
pull request is mergeable now, squash-merge it. If requirements are still
running and the user asked for merge-when-ready, arm only that pull request and
say that you armed it:

```
gh pr merge <pr> --squash --auto
```

Wait for that pull request to merge before preparing the next one. Auto-merge
is a request to GitHub for one pull request, and it is not evidence that the
stack is ready, that a descendant is queued, or that any verdict is current. Say
so rather than reading readiness into it.

## Phase F: Recompute

After every merge: fetch trunk, confirm the merged SHA is present, drop that
pull request from the bottom-to-top list, and inspect the new bottom one's base,
head, checks and patch-id. A host may retarget a child for you; do not assume
it did. Repeat Phases C through E for that one pull request. Independent work
stays outside this chain and ships on its own.

If the queue stalls, diagnose before you touch anything. A pull request closed
without merging, a required check that failed with no auto-merge pending, or a
`mergeStateStatus` of `UNSTABLE` or `DIRTY` is a hard failure and stops the run.
A `BLOCKED` state while checks are pending, or while auto-merge is armed, is not
failure and is not a reason to go around the queue.

## Phase G: Report

Stop at the ceiling. Extending the run is a fresh pass through Phase A, not a
continuation of this one.

## Outputs

The verified run and its ceiling, each verdict and its author, what you armed
and how you confirmed it, what landed, and what verifying the next one takes.
