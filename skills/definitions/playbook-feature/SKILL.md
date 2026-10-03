# Playbook Feature

Own a new capability from the subsystem map to a shipped branch. The design is
yours, the implementation may not be, and the shape of the task is settled
before any worker starts.

`architect` settles the types, the signatures and the module layout before code
exists. This is the whole lifecycle around that: grounding, splitting,
delegation, verification and the branch. When choosing the shape is the only
thing left to do, `architect` alone is the right load.

## Start

Open a `todolist` with one entry per phase. Rewrite it at each phase boundary;
a checklist written once at the start is a wish list by the fourth phase.

1. Ground
2. Shape
3. Split
4. Build
5. Prove
6. Ship

## Phase A: Ground

`how` over the affected subsystem, so the feature lands on what is already
there rather than beside it. Name the seams it attaches to, the conventions it
has to match, and the tests that already cover the ground it will sit on.

Finish with one sentence: what exists, and what is genuinely new. That sentence
is what Phase C splits against, and a version of it that says "everything" is a
sign the `how` pass was too shallow.

## Phase B: Shape

Run `architect` for the design: the types, the signatures, the module layout, and
the data shape and its organizing structure, chosen before a delegate writes any
logic. If the implementation admits several valid shapes — error handling, an
abstraction layer, a test structure — delegate the choice through `arena` so the
runners surface the alternatives and the cross-judge guards the pick. There is
no skip-with-reason escape here, and laziness does not override it: the gain is
review separation, not lines saved.

If the design is contested before it ships, `interrogate` it.

## Phase C: Split

Write the checkpoint as four `todolist` entries. A dimension that genuinely does
not apply keeps its entry with `n/a: <reason>` rather than being dropped, so the
next reader can tell a considered decision from an oversight.

1. **Blocking first steps.** The gates that run before anything fans out.
2. **Independent workstreams.** Disjoint files, services or layers parallelize.
   Shared writes serialize.
3. **Shared mutable state.** Default to splitting the target rather than
   serializing writes to it. Serialize only for a real invariant, and name the
   invariant. `tools.spectre.worktrees` says what a parallel workstream would
   collide with.
4. **Smallest safe decomposition.** If one worker is best, name why.

Code-coupled work — one feature, one migration — goes to a single owner who fans
out internally after the blocking phase. Parent-level fan-out is for slices that
produce independent artifacts. Spawn a fresh owner rather than chaining
interrupts, and never answer with a standing-by message that waits on a nested
agent.

## Phase D: Build

Delegate the code to a `subagent` with a specific scope: the file paths, the
named data shape and the structure holding it, the success criteria. Choose the
model with `tools.spectre.routing({})` and never write a model id by hand.

Make surgical edits, and re-ground against the upstream file for anything derived from it. A file you did not read is a file you cannot edit safely. When a shared primitive improves, apply the improvement to every consumer
and verify each one; leaving three consumers on the old behaviour is a
migration you did not finish.

Before deleting a comment or a suppression, run `tools.spectre.comments` over
the target. A comment is often the only record of why a line exists, and
deleting the code under it throws the record away with it.

## Phase E: Prove

Verify on the matching surface, the same way `playbook-bug-fix` does.
"Inconclusive" or the wrong surface is not a pass; flag it.

Work in small units: build one, verify it, commit it, then the next
(`principle-sequence-verifiable-units`). A branch of twenty commits that were
each green in turn is a branch a reviewer can take in a week; one commit of
twenty changes is a branch nobody reads.

## Phase F: Ship

Rebase into small ordered commits and let `tools.spectre.stack` settle the pull
request order, then open it with `gh pr create`. Tables for design
alternatives, so the rejected options and their reasons travel with the code.

## Outputs

What you built, what you chose and why, the four-item checkpoint as it stood at
the end, and the open decisions — anything a reader has to supply that the branch
does not decide.
