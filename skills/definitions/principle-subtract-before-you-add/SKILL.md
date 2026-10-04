# Principle: Subtract Before You Add

Remove complexity first, then build on the simpler base, because new code on top
of dead code inherits the dead code's weight. Without this every addition costs
more than it should: you read around dead branches to find the live path, extend
an abstraction nothing needs, and wire a feature into plumbing that exists only
because nobody deleted it. The change works, and the codebase gets heavier by
both the old weight and the new. Do that for a year and the simple change becomes
the one nobody volunteers for. This is the builder's sequence. `principle-laziness-protocol`
already owns deletion-first as reader-load discipline, and this leaf does not
repeat it. What laziness does not say is that the deletions come first, are
checked on their own, and are the ground the addition is written against.

There is no single question that proves you subtracted enough, and a rule that
offered one would be selling a number. The moment is the whole rule. Before you
add anything, read the area for what can go first: dead code, unused flags,
wrappers that forward once, options nobody passes.
Delete those, run the project's checks, and only then build. The simpler base is
the evidence, not a score.

## The moves

**Read the area you are about to change for what it does not need.** The file you
are editing, its immediate neighbours, the test you will have to touch. Deletion
found three files away is a real change and a different one, and the scope of
this move is what makes it cheap.

**Delete before you design, not after you build.** The design you would write on
a cluttered base is a design that works around the clutter, which is why the order
is the claim rather than a preference. The same feature written on cleared ground
is usually a different design and usually shorter, and by the time the clutter has
been noticed the new code has been shaped around it.

**Run the project's checks on the deletions alone, before the addition.** A
deletion is a change with its own blast radius, and the checks are the only
evidence it was safe. A red here has told you that code you assumed was dead was
quietly load-bearing, and that is the finding you wanted, arriving before the new
feature is in the way of reading it.

**Land the subtraction as its own unit.** Deletions and additions in one diff hide
which one broke the check, and the check is the only evidence either was safe. A
commit that only removes things is the easiest change to review and the easiest to
revert on its own, and the reversion leaves the addition intact.

**Subtract the concept, not the line you happened to see.** A flag with two
writers is one fact, and removing one branch of it leaves the concept standing
with fewer users. Ask what the area is doing that nobody is asking for, and take
that out too, because the leftover is the same clutter at a smaller scale.

**Take the option nobody passes before you add the option somebody might.** A
parameter that every call site passes the same value for costs a reader at every
site to explain, and your new one is the third value on a concept that should not
be standing.

**Count what is left to read once the deletions land, then write against that
count.** The cleared ground is an input to the design rather than a report filed
afterwards, so the counting happens before the writing. A design whose size you
already know is a design you can tell is too big while changing it.

**Name what you subtracted when you report.** The count of deletions is a fact
about the change and the number nobody asks for. If you cannot list what went, you
did not do this, whatever the diff appears to say.

**Subtract the test that belonged to the removed path, in the same unit.** A test
that fails after the deletion is reporting that the path was used, and that is a
fact to establish rather than an obstacle to argue past. Leaving the test behind
because it was green before the change is how a removal becomes a removal nobody
verified.

**Do not subtract the code you were asked to change.** The diff is the work.
Deleting a neighbour inside the same change is a review tax that hides the real
edit, and the rule that a diff is about one thing is `principle-hygiene`'s. Clean
what you are already changing. The rest is a change of its own.

**When the subtraction is the whole task, stop.** A change that ends smaller and
does more is complete. Continuing to build because the ticket said feature is
scope creep wearing this principle as a hat, and the extra surface is the next
person's problem rather than yours.

**Re-ask the question after the addition lands.** The new code has its own weight:
a helper with one caller, a config nobody sets, a name used in one file. The same
question, cheaper now, because you know what the area looks like and you are
standing in it.

**Do not subtract to hit a number.** Deleting lines is not the goal. A change
that improves a ratio by removing a test is worse than one that adds forty lines
and deletes one. The claim is about what the area has to carry, and a tally
cannot carry it.

**Take the whole removal or none of it.** Removing the last caller of a flag and
leaving the parameter turns one dead concept into a live one with a condition
attached, which costs more to read than the original did. A deprecation left
"temporarily" is that shape with a second reader, and the temporary part is the
part that never ends.

## What this principle is not

- **Not "delete more than you add".** A tally is not a discipline. Deleting a
  used function to improve the ratio is a defect with a diff attached, and the
  next change pays for it in full.
- **Not a licence to widen the change into the repository.** The scope is the area
  the change touches. What else is nearby is real work and a legitimate separate
  change. Folding it in is what makes the review fail and the subtraction get
  reverted with the feature.
- **Not a demand to clean the repository.** A sweep of what else is lying around
  is `principle-hygiene`'s, and it competes with the change for the attention the
  change needs to get reviewed.
