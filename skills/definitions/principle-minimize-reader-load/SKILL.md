# Principle: Minimize Reader Load

Maintainability is reader load, and reader load has exactly two axes: hops to
trace, which is how many definitions sit between a reader's question and its
answer, and state to hold, which is how much hidden or mutable context they carry
while they read. The axes are independent, and that is the part worth keeping. A
flat file with fifty globals has no hops and bottomless state. A pure pipeline ten
frames deep has no state and exhausting hops. Cutting one while growing the other
is a transfer, not an improvement. This leaf is about code already on the page;
`principle-laziness-protocol` is about the addition that does not exist yet, and
the clause that separates them is before versus after. Laziness owns the refusal,
this leaf owns the two axes once there is something to read, and neither answer is
any use without the other.

Laziness's reader half says this already, in its own words, and a reader who has
loaded that leaf should not take this one for a second opinion of it. It owns the
narrowing ladder, the two questions asked before leaving the code, the count of
files a change reaches, and the instrument. What is left here is the part laziness
does not say: how to read two numbers instead of one, what a transfer looks like in
a diff, and the fact that load reproduces itself, which is why a repository nobody
prunes gets harder to read while no individual file changes.

The test is timed, and it is the one part of this that is actually falsifiable.
Hand the code to a reader who did not write it and ask two questions, in this
order: where does X come from, and what can change X. Thirty seconds each. The
first is a hop question and the second is a state question, and the order matters
because the second presupposes the first: a reader who cannot find where a value
is produced cannot enumerate everything that mutates it, so one slow answer
usually explains the other. Thirty seconds is a line rather than a target,
because it is roughly what a question costs when nothing is in the way of it, and
a session is minutes long.

What earns the leaf its own place is that load is self-reproducing. Code that
cannot be traced cannot be changed safely, so it gets wrapped, and the wrapper is
a hop for whoever reads it next, whose question is now two hops deeper. A change
whose reach nobody could scope becomes a change with a flag, and the flag is state
every later reader carries. Each of those is a rational response to load and each
adds load, which is how a codebase gets steadily harder to read with no change to
any single file and every change local and reasonable.

## The moves

**Map the slow answer to its axis.** "Where does X come from" took a minute means
hops. "What can change X" took a minute means state. Do not fix both when only one
is slow, and read the second answer through the first, because a reader who cannot
find the source is reporting a hop problem inside what looks like a state problem.
The tell that state has been promoted too far is a value read before it is written
in file order.

**Take both numbers from one run of one tool, on one commit.** The two verbs that
exist for this are laziness's, `--context-ratio` for the hops and how much of the
knowledge sits outside the file, and `--nonlocal-state` for the mutable state a
function can reach. A single number is a tripwire, and two numbers from the same
revision is a report: one falling while the other rises is a transfer that has
already happened, and reading them apart is how a transfer gets reported as a
simplification.

**Name a transfer in the change, in those words.** When you cut hops and add
state, say so in the commit and the review: three layers flattened, six fields
promoted, reader load moved from tracing to holding. It costs one sentence and it
is the only place the trade is visible to the person who did not make it.

**Watch the promotion that pays for the flattening.** The commonest transfer is
merging layers: two locals become a field, because the merged function now serves
both callers. State bought with hops, and the diff shows only deletions, which is
why it passes review as a cleanup.

**Follow the escalation loop and stop it at the first link.** Wrapper around
untouchable code, flag added because the reach could not be scoped, a second
parse added because nobody agreed on a shape: each is a rational response to load
and each is more load. Find the first one, because a loop cut anywhere else
restarts.

**Scope the change with the state question, before you make it.** "What can change
X" asked at a call site is the same question asked before an edit, and it is what
makes a change safe to make rather than a thing to wrap afterwards. The file count
is laziness's instrument for it; the reason it is worth running first is that a
reader who cannot answer the question does not edit, they add a flag.

**Use a comment where the shape cannot carry the fact.** A comment that exists
because the code was unclear is a record of a simplification that did not happen.
A comment that carries a fact the types cannot say is paying the reader's cost on
purpose, and it is one of the few places that is the right trade. Delete the ones
a change made unnecessary while you are in the hunk anyway.

**Spend the lookup on a name that says what it holds.** Every unfamiliar noun is a
search, and the search happens once per reader rather than once per author. The
name that costs a line and answers itself is cheaper than the abbreviation that
saves the line, and length is not the axis being measured.

**Re-read your own change as a stranger.** Put the diff down, open the files, and
ask the two questions again about the value you just touched. You are the only
reader in the session who has the context, which is exactly why you are the one
who cannot tell whether the file still works without it.

**When a fix must add structure, put it on the axis that is already low.** A
reader who already holds the whole state can afford one more frame. A reader
already crossing five frames cannot afford a sixth, and the frame that looks like
a tidy extraction is the one that pushes them over.

## What this principle is not

- **Not a demand to make everything one hop away.** Some searching is necessary
  work: finding a decision the reader is allowed to make, or a precedent for a
  choice the code does not explain. The thirty seconds is about the questions the
  reader arrived with, not about the size of the codebase.
- **Not a licence to flatten a wrong computation.** Hard to follow and wrong are
  different findings, and a flattening that makes a defect easier to copy has not
  reduced anything. Fix the cause first, and that is
  `principle-fix-root-causes`'s question, not this one's.
- **Not a licence to move logic out to shorten a function.** Extracting the
  decision that made a function hard to read moves the load to the caller instead
  of removing it, and the diff reads as a simplification. That is a transfer, and
  it is named as one above.
