# Principle: Outcome-Oriented Execution

A plan that spans commits names the state it is converging on, and every commit
is measured against that state rather than against its own comfort. A
half-migrated tree is fine on the way. A half-migrated tree that is what you
shipped is not.

The distinction this draws is between a transition and an end. During a
transition, partial states are normal and cheap, because the next commit is
already written down and the cost of being half way is bounded by that plan. The
red flag is a partial state with no declared end: a branch where the old path
still has callers, the new one has some, and nobody wrote which commit removes the
old one. That is not a migration in progress, it is a fork that got committed.

So the question is never "is this commit complete". It is "is the end named, and
has it been reached". Those are different questions with different answers. A
reviewer who asks the first one rejects correct work, and a reviewer who never
asks the second one ships the fork.

The discipline is mostly writing things down: name the end, name the boundaries
where you check, and check the end itself rather than trusting a sequence of green
runs to have proved the destination. What to delete when the migration finishes is
`principle-migrate-callers-then-delete-legacy-apis`, and whether a check can fail
at all is `principle-evidence`.

## The moves

**Name the end state before the first commit.** Not the goal, the state. "Callers
move to `parseConfig` and `loadConfig` is gone" is a state. "Clean up the config
code" is a wish, and a wish cannot tell the last commit from the first. Write it
where the plan lives, so every commit can be read against it.

**Decide which checks run at which boundary.** A multi-commit plan does not run
the whole suite after every commit, and it does not run nothing until the end
either. Name the cheap check that runs per commit, which is the one that catches
the file you just touched, and the full check that runs at the boundary where the
plan claims something new. A plan with no named boundary is a plan where the
verification drifts to wherever it is cheapest to run.

**Keep the per-commit check scoped to what the commit touched.** The full suite on
every commit of a forty-commit migration costs more than the migration, and it
gets skipped by commit twenty, so the boundary that mattered is the one that
disappears. The narrow check that runs every time is what makes the wide check at
the end worth anything.

**Treat a passing intermediate run as no evidence about the end.** Twenty green
runs are twenty facts about twenty trees. None of them is a fact about the state
the plan converges on, and the last commit is usually a deletion, which is the
commit least likely to be covered by a test written for the old shape. The end
gets its own verification, on its own.

**Ask what would fail if the plan stopped short.** The check that matters at the
boundary is the one that would have caught it. If the plan says the old path is
gone, the check is whether anything still reaches it, and the boundary is the
commit where the last caller moved.

**Keep the end and its owner in the same place.** A plan nobody owns reaches its
end when whoever is next happens to notice. That is the same decay as a
`TODO: remove in v3` with no version attached, and it is `principle-hygiene`
applied to a plan rather than to a line of code.

**Reopen the end when the plan grows a phase.** A migration that turns into three
has three ends, not one at the far end. Each phase boundary gets its own
verification, because the last phase is a long way from the last time anyone
checked anything.

## What this principle is not

- **Not an argument for a broken intermediate state.** A transition may be
  partial. A tree that does not build, does not pass, or cannot be checked out is
  a different thing, and it makes the next commit's check unable to run, which
  removes the boundary this principle depends on.
- **Not a licence to keep both paths until someone remembers.** The end has to be
  named and reached. An unnamed end is the failure, and "we will delete it in the
  follow-up" is an unnamed end with a date-shaped label on it.
- **Not permission to widen the plan.** A named end is not a licence to add phases
  the original question did not need. The end is what makes the sequence
  iterable, and a sequence whose end keeps moving is not a plan.
