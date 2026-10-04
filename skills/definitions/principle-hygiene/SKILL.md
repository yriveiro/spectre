# Principle: Hygiene

## What this principle is

Hygiene is the craft of not leaving small things small.

Every deferred detail is cheap on its own and ruinous in aggregate. A dead branch
nobody deleted, a dependency nobody bumped, a shortcut marked "clean this up later".
Each is a rounding error, and a codebase made of rounding errors is not a
codebase anyone can safely change. Mess never arrives as mess. It arrives as four
hundred small concessions, each defensible alone, that together cost more than the
work they saved.

So hygiene is not perfection. Nobody finishes a change with the whole file
perfect, and pretending otherwise is how hygiene becomes a ritual nobody keeps.
It is custody: leave what you touched better than you found it, do not walk past
what is already broken while you are standing on it, and accept that this is
cheaper today than in six months.

The steady state is a codebase that is not larger than it was. A change is allowed
to add what it needs and to remove more, so the surface after it is the same size
or smaller and does more. A change that ends with a bigger surface and nothing
deleted has spent the budget it was given on a net addition, and the next change
pays for it. This is the continual form of the same claim, not a stricter one: the
unit is the codebase, not the file, and a per-file tally that adds up to growth is
not the win it looks like.

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
have to invent to keep it. Dead code is the narrower question: nothing reaches it.
The wider one is a path with a replacement that callers still use.

**Move what is safe to move.** A dependency inside its range that is not moved is
a risk deferred by default. Check the bump before taking it, then take it when
the project's own checks say it holds.

**Care, not obsession.** Detail is a means. The goal is work someone else can
maintain, not work with nothing left to improve. Perfectionism is what people
start calling hygiene when they have stopped shipping.

## Strategies

How the values are applied at the level of judgement:

**Fix it while the context is loaded.** You are already reading the function and
already have the checks in your hand. This is the cheapest moment in the
project's life to remove the thing, and the only one where the removal is obvious.

**Delete before you abstract.** A path that has a replacement does not need a
flag, a comment, or a condition. It needs to go.

**Take the safe upgrade.** When a dependency has a newer version inside the range
it already claims, and the project's own checks pass on it, move it. "Outdated" is
only a real risk when something breaks, and a check that passes is the evidence
that this one does not. When the bump crosses a major, or the checks do not pass,
that is not hygiene. That is a task. Say so and schedule it instead of filing it
as fine.

**Delete before you build on top.** The base a new thing sits on decides how much
of it is necessary. A codebase carrying four redundant validators and a stub with
no content underneath needs those gone first, because the design that looks obvious
on the clean base is invisible on the cluttered one. Sequencing is
`principle-laziness-protocol`, which owns removal before addition as a decision to
make before any code exists. This is the same order seen from the other end, once
the addition is written.

**Separate dirt from damage.** Dead code, a stale comment, a duplicated block:
hygiene. A wrong invariant, a silent failure, a security hole: a bug, and it gets
reported as a bug. Do not tidy your way past a defect you found, and do not
relabel a defect as tidying to avoid the harder conversation.

**Prefer the version that needs no explanation.** Of two equally working
implementations, the one a reader needs no comment to understand is the cleaner
one. A comment that exists because the code was unclear is a record of a
simplification that did not happen.

**Count what the change removed, not only what it added.** A diff that adds forty
lines and deletes none is a net addition, whatever the ticket asked for. The
deletions were available the whole time, and taking them is the difference
between a codebase that stays the size it is and one that grows a little on every
change until nobody can find anything.

**Let the tools do the trivial parts.** Run the formatter, the linter, the
dependency audit. Manual tidying of what a tool already does is where attention
goes to waste.

## Tactics

The mechanical habits. These are the details. The values above are why they are
not optional.

**Remove what nothing reaches.** Unused exports, unreachable branches,
commented-out blocks, a helper kept "just in case." Deletion is verifiable: the
check either still passes or it does not, and either answer is a fact. Two
neighbouring questions are not this one. A layer with one caller that only
forwards is redundant, and that is `principle-laziness-protocol`. An old path
whose callers you have not moved yet is
`principle-migrate-callers-then-delete-legacy-apis`.

**Take the whole bump, not the easy half.** A change that moves the direct pin but
leaves a second copy of the same package behind is a known problem with extra
steps. After any change of this kind, prove it was coherent. The pin, the
lockfile, and any transitive copy all moved together, and the superseded value
appears nowhere.

**Re-read every comment in a hunk you touched.** A comment describing what the
code did before your change is now a lie. The ones that survived your edit should
still be true. The rest go with the code they described.

**Let the linter tell you where you stopped reading.** A warning you have seen and
ignored is a decision you made. Fix it, or write down why it stays, so the next
reader is not quietly re-deciding the same thing.

**Keep the diff about one thing.** Unrelated tidying inside a change is not care;
it is a review tax, and it hides the real edit. Clean what you are already
changing. Leave the rest for a change that is about it.

**Check the tree before you call it done.** A workspace dirtier than you found it
(a temp file, a debug print, a widened ignore, a dependency the install quietly
moved) is the most common way good work gets delivered in a bad state. Reporting
on it is `principle-verification`.

**Judge the rot you are standing on.** If you notice a stale comment, an outdated
dependency, or dead code in the area you are already inside, it is now yours to
judge. Ignoring it on purpose is a decision. Make it consciously or do not make
it.

## What this principle is not

- **Not a formatting obsession.** Run the formatter; that is what formatters are
  for. This principle concerns what is true and what is reachable, not what is
  aligned.
- **Not maximalism.** Hygiene is proportional to the stakes. A throwaway probe
  owes nobody a tidy-up. The artifact other people depend on owes everybody one.
  Cleaning code nobody will read is a cost paid for nothing.

