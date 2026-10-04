# Principle: Sequence Verifiable Units

Order work as small units that each end in a checkable state, and do not advance
until green. Without this you carry three half-done changes at once, and when the
check fails you cannot say which one broke it, so debugging becomes archaeology:
you revert all three, or you push forward on a red base and stack new work on a
state nobody trusts. Every later check then inherits the doubt of the earlier one
you skipped, and the last check in the sequence is the only one anybody reads.
The test is the bracket: each unit opens on a known-good state, makes one change,
and closes with the check. This leaf is the ordering around a check, not the
check itself.

The moment is any task with more than one step: a migration, a refactor across
files, a feature with setup plus behaviour plus cleanup. Cut the sequence before
you start and write each bracket down, because a bracket that lives only in your
head dissolves at the first surprise. Whether a check is honest about what it
covers is `principle-verification`. Which checks belong at which boundary across
a whole plan is `principle-outcome-oriented-execution`. What the closing assertion
should say is `principle-test-behavior-not-implementation`. This one is the unit,
the check, and the rule about not advancing on red.

## The moves

**Run the check on the tree before your first edit.** The starting state is green
or it is not, and "it was already broken" is the only sentence that ends every
later argument about a red suite. It is available at exactly one moment, which is
before anything is changed, and unavailable for the rest of the session.

**Write the triple down before you write the change: state, change, check.** Name
the known-good state you are opening on, name the single change, name the command
or the observation that closes it. A unit you cannot state is not a unit, it is a
step, and steps are where a session loses its place and starts guessing what it
was doing.

**One change per unit, and a unit that says "and" is two units.** Two changes in
one bracket is two suspects in one red, which is the archaeology this principle
exists to prevent. If the description of the work contains a conjunction, cut
there, before the first edit rather than after the failure.

**Run the check at the end of every unit and read its output.** The typecheck, the
test run, the command whose output you read with your own eyes. A check whose
output nobody read is a state that has not been observed, and the next unit is
built on an unobserved one while looking exactly like a known-good one.

**Stop on red and fix inside the unit that went red.** Not in the next one, and
not on top. Work stacked on an unverified base inherits the doubt, and by the
third unit a failure could belong to any layer of everything you did since.

**Do not batch the checks.** Three changes followed by one check is three units
collapsed into one, and it is the most common way a session ends with a red suite
and no idea which edit did it. The batching feels efficient because the three
edits are already in your head, and the cost arrives later at a point where the
context that would have identified the culprit is gone.

**Keep a unit small enough that a red leaves one suspect, not five.** Smaller
brackets cost a few more check runs and save the whole debugging session, because
the cost of a red is the search rather than the rerun. Five minutes of green
repeated twenty times is cheaper than forty minutes of archaeology.

**Run the cheapest check that covers the change, on every unit, and name which
one it is.** A full suite on every unit of a forty-unit change gets skipped by
unit twenty, and the skip is the check that mattered. The narrow check that runs
every time is what makes the wide check at the boundary worth anything.

**Split a unit the moment it starts holding two things.** Two files, two
behaviours, two ideas: cut when the second thing appears, not when the check goes
red. Cutting after the red means doing the archaeology once, which is the one
thing the sequence was supposed to make unnecessary.

**When a unit goes red, get it green or revert it; do not carry it half-finished.**
A half-finished red unit is the worst input the next unit's debugging can get,
and it is worse than a clean failure because the failure now has an unfinished
edit sitting on top of it.

**Order the units so each one is independently reversible.** A change that makes
no sense without the change after it is a phase, not a unit. Name it a phase and
give it one end state, because a phase is what a plan is made of and pretending
it is three units is how a migration ships as a fork.

**Put the first unit in the smallest file you can.** Not out of caution. The first
red is then cheap, the context is fresh, and the design question surfaces before
it has been spread across nine files and argued into all of them.

**Write the units down with the state of each one.** The list is the answer to
where you were after an interruption, and it is the thing that stops a surprise
from dissolving the sequence in your head. A bracket nobody wrote down is a
bracket that has to be reconstructed from memory, under pressure, with a red
suite waiting.

**Check the end once, at the end, yourself.** The last unit's green says the tree
is green. It does not say the tree does the thing, and a plan that verifies only
its final bracket verified its own bookkeeping. Which surface proves the thing
is `principle-prove-it-works`.

**Count what a unit bought.** A unit that changes no behaviour and moves no check
closer to the end is a commit, not a unit. Naming the two apart is what stops a
session from becoming a hundred units long, and a hundred units is the same
failure as three changes in one bracket: the check stopped being able to tell you
anything.

## What this principle is not

- **Not a demand for one command per edit.** A one-line fix whose test takes two
  minutes is a unit with an expensive check, and it is still a unit. The rule
  counts the suspects inside a red, not the price of the check.
- **Not a licence to make units so small the session is bookkeeping.** Five-minute
  units across a change with two parts produce twelve units and a plan nobody can
  read. Cut where the next suspect would go, and not everywhere else.
- **Not permission to fold an unrelated red into your unit.** A red you found
  before your first edit is a finding. Report it, and open on the state the plan
  claimed was green, because absorbing it puts two changes in one bracket and
  returns you to the search this principle exists to delete.
