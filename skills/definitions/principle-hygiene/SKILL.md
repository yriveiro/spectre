# Principle: Hygiene

## What this principle is

Hygiene is the craft of not leaving small things small.

Every deferred detail is cheap on its own and ruinous in aggregate. A dead branch
nobody deleted, a dependency nobody bumped, a shortcut marked "clean this up later"
— each is a rounding error, and a codebase made of rounding errors is not a
codebase anyone can safely change. Mess never arrives as mess. It arrives as four
hundred small concessions, each defensible alone, that together cost more than the
work they saved.

So hygiene is not perfection. Nobody finishes a change with the whole file
perfect, and pretending otherwise is how hygiene becomes a ritual nobody keeps.
It is custody: leave what you touched better than you found it, do not walk past
what is already broken while you are standing on it, and accept that this is
cheaper today than in six months.

The test is not "is this code perfect." It is "could I touch this again, on a bad
day, without a grudge."

## Core values

**Small things compound.** No mess arrives as a mess. It arrives as a hundred
tolerated details. Each one is judged at its own size, and the mess is what those
judgments add up to.

**Leave it better than you found it.** Whatever you disturbed, restore or
improve. A workspace left dirtier than it was found is a statement about the work.

**Clean while you are already there.** The code you are refactoring is the
cheapest code you will ever clean: you have the context loaded and the checks in
your hand. "A cleanup pass later" is a pass that never comes, and it is the same
work with none of the context.

**Dead code is not free.** It is read, reviewed, and misread forever. Deleting it
is a change, and a deletion is easier to verify than the replacement you would
have to invent to keep it.

**Move what is safe to move.** A dependency inside its range that is not moved is
a risk deferred by default. Check the bump before taking it — then take it, when
the project's own checks say it holds.

**Care, not obsession.** Detail is a means. The goal is work someone else can
maintain, not work with nothing left to improve. Perfectionism is what people
start calling hygiene when they have stopped shipping.

## Strategies

How the values are applied at the level of judgement:

**Fix it while the context is loaded.** You are already reading the function and
already have the checks in your hand. This is the cheapest moment in the
project's life to remove the thing, and the only one where the removal is obvious.

**Delete before you abstract.** A leftover path that has a replacement does not
need a flag, a comment, or a condition. It needs to go. Building a way to keep it
alive is adding the mess back with a schema.

**Take the safe upgrade.** When a dependency has a newer version inside the range
it already claims, and the project's own checks pass on it, move it. "Outdated" is
only a real risk when something breaks, and a check that passes is the evidence
that this one does not. When the bump crosses a major, or the checks do not pass,
that is not hygiene — that is a task. Say so and schedule it instead of filing it
as fine.

**Separate dirt from damage.** Dead code, a stale comment, a duplicated block:
hygiene. A wrong invariant, a silent failure, a security hole: a bug, and it gets
reported as a bug. Do not tidy your way past a defect you found, and do not
relabel a defect as tidying to avoid the harder conversation.

**Prefer the version that needs no explanation.** Of two equally working
implementations, the one a reader needs no comment to understand is the cleaner
one. A comment that exists because the code was unclear is a record of a
simplification that did not happen.

**Let the tools do the trivial parts.** Run the formatter, the linter, the
dependency audit. Manual tidying of what a tool already does is where attention
goes to waste.

## Tactics

The mechanical habits. These are the details; the values above are why they are
not optional.

**Remove what nothing reaches.** Unused exports, unreachable branches,
commented-out blocks, a helper kept "just in case." Deletion is verifiable: the
check either still passes or it does not, and either answer is a fact.

**Take the whole bump, not the easy half.** A change that moves the direct pin but
leaves a second copy of the same package behind is a known problem with extra
steps. After any change of this kind, prove it was coherent — the pin, the
lockfile, and any transitive copy all moved together, and the superseded value
appears nowhere.

**Re-read every comment in a hunk you touched.** A comment describing what the
code did before your change is now a lie. The ones that survived your edit should
still be true; the rest go with the code they described.

**Let the linter tell you where you stopped reading.** A warning you have seen and
ignored is a decision you made. Fix it, or write down why it stays, so the next
reader is not quietly re-deciding the same thing.

**Keep the diff about one thing.** Unrelated tidying inside a change is not care;
it is a review tax, and it hides the real edit. Clean what you are already
changing. Leave the rest for a change that is about it.

**Check the tree before you call it done.** A workspace dirtier than you found it —
a temp file, a debug print, a widened ignore, a dependency the install quietly
moved — is the most common way good work gets delivered in a bad state.

**Judge the rot you are standing on.** If you notice a stale comment, an outdated
dependency, or dead code in the area you are already inside, it is now yours to
judge. Ignoring it on purpose is a decision; make it consciously or do not make
it.

## What this principle is not

Guards against the failure mode of every principle, which is becoming a ritual
performed for its own sake.

- **Not a formatting obsession.** Run the formatter; that is what formatters are
  for. This principle concerns what is true and what is reachable, not what is
  aligned.
- **Not maximalism.** Hygiene is proportional to the stakes. A throwaway probe
  owes nobody a tidy-up; the artifact other people depend on owes everybody one.
  Cleaning code nobody will read is a cost paid for nothing.
- **Not a licence to expand the change.** Care is not scope. A drive-by rewrite
  inside a bug fix is still scope creep — it just arrives with good intentions
  attached, which is what makes it hard to refuse.
- **Not a gate.** Tidying nobody performs proves nothing. A cleanup ritual nobody
  acts on is a slower way to feel productive.
- **Not gatekeeping.** The target is code that is kept, not authors who are caught
  out. Apply it to your own diff first, and most often.
