# Principle: Attack The Premise

Two or more fixes built on one premise, failing the same gate, are evidence
against the premise and not a request for a third fix. A failed fix always feels
like progress, because it is a fresh attempt at the same bet, and the gate keeps
collecting the same answer — so the third attempt arrives with less information
than the first and more sunk cost behind it. This principle owns the middle case
between diagnosing one failure and choosing between novel options: a single
failure is `principle-verification`'s to reproduce and check, and a decision with
no precedent at all is `principle-exhaust-the-design-space`, where competitors
get built before anyone commits. The test is a sequence rather than a question.
The premise is written down in one sentence and the failures against it are
counted before the next fix exists.

## The moves

**Write the premise in one sentence, as an assertion that could be false.** "The
index is the fast path." "Inputs arrive normalised." "The third party is
reliable." A sentence with no subject and no falsifier is a mood, and a mood
cannot be attacked, only obeyed. If the sentence resists being written, that
resistance is the finding, and it is worth more than the fix you were about to
start.

**Count the failures against the sentence, and keep the count where you can see
it.** Two fixes, one premise, one gate. The count is the evidence, and memory is
not: by the third attempt the first failure reads as something already handled,
which is precisely what memory does with a thing it wants you to keep doing.

**Do not start the next fix before the sentence is on the page.** The order is
write, count, attack, then build. Fix-first is the failure mode, because a fix in
hand is progress you can point at, while a sentence in hand is a suspicion you
would have to defend.

**Answer the counterfactual: what would I try if this sentence were false?** If
the answer is nothing, the sentence is not the cause and the attack has not
happened. If the answer is a whole second plan, you found the shape of the
work, and the plan is the thing worth building.

**Name the gate both fixes failed.** Two failures at the same check are evidence
about a shared belief. Two failures at different checks are two problems, and a
sentence common to both is a coincidence that will mislead you. Write down what
the two attempts shared *at the failure*, not what they shared in general.

**Treat a narrowed fix as the same fix.** Fix three being fix two with a
different constant, threshold, or ordering is a fourth attempt, not a second.
Tuning is what a premise does as it starts losing: the search gets more local
exactly as the evidence gets more negative, and the local search is where the
afternoon goes.

**Attack by negation before you attack by replacement.** State the opposite
sentence and ask what the code would look like if it were true. Most premises are
wrong in one direction, so the negation is a cheap experiment: find the one place
the code assumes the opposite, and read that place.

**Find the zone the premise covers and read its border.** A premise always has a
scope — validated, reachable, small enough to fit in memory, owned by one team —
and the defect usually lives where that zone meets something it does not cover.
Read the boundary cases first: the second tenant, the concurrent writer, the
retry, the empty list, the input from outside.

**Ask what the code would have if the premise were true.** A premise that is
genuinely true usually has a seam: one place where it is enforced, one helper
every caller goes through. Find the site that relies on it *without* going through
that seam, and you have the defect the fixes were treating.

**When negation is impossible, prove the premise from scratch.** Some beliefs
cannot be falsified in place: a caching layer, a parse boundary, a concurrency
model. Then build the smallest artefact that has to be true if the sentence is —
a harness, a benchmark, a one-file reproduction — and read it directly instead of
arguing from the symptom.

**Write the replacement sentence before the fix that rests on it.** Same
altitude, falsifiable, one sentence. A fix that arrives before its premise is a
bet nobody can evaluate, because there is nothing to hold it against when it
fails.

**Record the attack even when it fails.** A premise that survives negation,
replacement, and a direct proof has earned its fixes, and the record is what stops
the next person from re-running the whole investigation. Attacking is expensive.
the evidence that it held is the part that would otherwise be re-derived.

**Name who holds the premise, not only what it is.** A premise that keeps
surviving has a holder, and a premise held by a person or a team is not refuted by
one counterexample. Writing the sentence down where they can see it turns a
private suspicion into a claim somebody else can attack, and that review is where
it finally gets tested.

## What this principle is not

- **Not "one more attempt, then decide".** Every additional attempt raises the
  price of quitting: with three fixes on the board, abandoning the premise means
  admitting three failures instead of one, so the premise survives on sunk cost
  alone. The attempt that was going to settle it is the one that has already lost
  twice.
- **Not a licence to relabel a single bug as a premise.** A premise is shared by
  several attempts. Attacking a belief that one fix happened to make is a
  root-cause hunt wearing this principle as a hat, and that is
  `principle-fix-root-causes`.
- **Not a licence to stop at the diagnosis.** Attacking the sentence moves the
  work rather than finishing it. A refuted premise with no replacement leaves the
  failure unrepaired, and the next session re-derives the whole thing from the
  symptom.
- **Not a reason to doubt every belief.** A premise with two counted failures is
  signal. A premise with none is a hypothesis, and suspending every hypothesis at
  once turns a session into an argument about beliefs rather than a fix.
