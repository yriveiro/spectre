# Principle: Fix Root Causes

A symptom is a report from somewhere else. The crash, the wrong value, the test
that passes on retry: each is the system telling you that something upstream is
wrong, and a patch at the site of the report leaves the wrongness exactly where it
was. This principle says trace the report to the defect and fix it there. It is
the discipline for the moment you are already inside: you hold a candidate patch,
and the question is whether it makes the cause stop or only makes the report
stop. It is adjacent to `principle-verification`, which owns the check that tells
you a fact is true, and to `principle-evidence`, which owns the oracle that turns
an argument into a number. This leaf owns the location of the fix and the standard
for calling it done.

The test is reproduction followed by honest asking. Reproduce the failure
somewhere that cannot damage the real thing, then ask why, and keep asking until
the answer is a defect you can point at rather than a condition you can guard
against. Five whys is a ritual; one genuine why, followed honestly, usually
reaches the cause. A condition you can name is the shape of the symptom, not its
cause: when the file is empty, when the third party is slow, when two people edit
at once. Those are descriptions of when the report fires. And the second half of
the test is cheaper than the first: a workaround that needs a paragraph of comment
to justify is the code telling you it is wrong, and the paragraph is the
confession.

Without this, code fills with guards. Each guard is reasonable alone: a nil check
here, a default there, a special case for the input that broke last month, covered
by a test so the suite stays green. Together they are a second system, one that
encodes every past failure as a permanent branch, and nobody can remove any branch
because nobody remembers which failure it encodes. A function with three unrelated
special cases in it is that system, and to the person who has to change it next
week it reads as cautious code rather than as a wall.

## The moves

**Do not write the patch until the failure has been seen.** A fix for a failure
you have not watched is a story with a diff attached. `principle-verification`
owns the reproduction; what is new here is the ordering, because a patch written
first is a guess that arrives pre-validated by its own test.

**Ask why until the answer is a place you can point at.** The cause is a defect:
the line that computes the wrong thing, the caller that passed the wrong
argument, the assumption that was never true. Keep asking until you can point at
a line, because a condition you can describe is the symptom wearing a
generalisation.

**Look for a fix that removes code.** The cause is the place where the change is a
deletion or a restoration, so the diff takes a branch out rather than putting one
in. If your patch adds a condition, you have probably stopped one layer short of
the defect.

**Treat a guard at the crash site as a report you silenced.** A nil check, a
default for the bad value, a catch that logs and continues, a retry around the
flake: each makes the symptom stop without making the wrongness stop, and the
report is the only thing that got quieter.

**Read the comment that justifies the strange code.** Someone already asked this
question and answered it in prose. Either the reason still holds, and you now
have a fact, or it does not, and the branch goes. A comment that says this is here
because it happened once is a permanent branch with a citation.

**Count the branches your past failures installed.** Each one was justified alone.
The tell is a function whose unrelated special cases have stopped sharing a
reason, because that is where the second system becomes visible.

**Fix every site the defect reached.** The same wrongness usually reports from
more than one place. A fix applied at the first report leaves the others live, and
the second report will cite the first patch as the reason nobody looked further.

**Ask whether the flake is a race.** A test that passes on retry has two code
paths and no ordering guarantee. The retry hides a race; the cause is the
synchronization that is missing, and it is a defect like any other.

**Name the invariant that was broken.** Most causes are an assumption that was
held rather than enforced, and naming it is how you know where the fix belongs.
When the right answer is that the shape should have made it impossible, that is
`principle-make-states-unrepresentable` applied at the cause instead of the
symptom.

**Push back on an input you cannot account for.** A patch that handles the value
is also possibly a string is a symptom patch wearing a type. Ask where the wrong
value was produced, and go there.

**Stop at the cause even when it is far from the symptom.** The distance is the
cost of the wrong fix and it is paid once. Which layer should own the fix is
`principle-boundary-discipline`'s question; the fact that it is upstream is this
one's.

**Say which class of reports the fix ends.** Not that the test passes, but that
any caller reaching this with X now gets Y. A sentence that names only the
reported input describes a patch on the report.

**Prove the cause was the cause.** Change the cause alone and the symptom must
disappear; change something else and it must not. `principle-evidence` owns
building the oracle; applying it to a causal claim rather than to a performance
claim is the step this leaf asks for, and it is the one that distinguishes a fix
from a coincidence.

**Delete the workaround when you delete the cause.** Move the old path's callers
first, then remove it in the same change. Leaving it behind leaves a second
implementation of the wrong behaviour, which is the failure this principle exists
to end.

## What this principle is not

- **Not a demand to search further forever.** Stop when the answer is a defect you
  can point at. Chasing a deeper cause past that is how a bug fix turns into an
  architecture project, and it usually ends with the bug still there.
- **Not "add a test and call it fixed".** A test that pins the symptom stops the
  next person looking further, which is the opposite of what you wanted. A test
  that reproduces the failure is evidence; a test that asserts the guard holds is
  a lock on the workaround.
- **Not a ban on defensive code at a real edge.** Where untrusted input genuinely
  enters, validation is not a workaround, and the ban here is on guards for states
  the system itself produced. Moving a check to the edge is
  `principle-boundary-discipline`'s move.
- **Not a licence to refactor what you were standing next to.** Fixing the cause
  and tidying the neighbourhood are two changes, and merging them hides which one
  was necessary. If the cause is spread across three files, say so and let the
  reviewer see the size of it.
