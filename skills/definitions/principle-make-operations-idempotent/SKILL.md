# Principle: Make Operations Idempotent

## What this principle is

An operation that changes state should reach the same end state whether it ran
once, twice, or after dying halfway. The state left behind by the last attempt
must not decide what this attempt does.

Crashes, restarts, and retries are normal in the places this applies: a command
somebody runs again because the first one looked wrong, a lifecycle step the
platform restarts, a loop the scheduler respawns, a migration a deploy retries.
If partial state changes the next run's outcome, then every restart becomes a
debugging session, and the debugging session is about the state rather than about
the bug that was being fixed.

Three questions, asked before the code is written:

1. What happens if this runs twice in a row?
2. What happens if the previous run died at every possible point?
3. Does re-execution converge to the same end state?

An answer of "it depends on what state was left behind" is not an answer to a
question about your code. It is a description of a reconciliation step you have
not written.

The word itself is used loosely, so the precise version is worth stating. Strictly,
idempotent means applying the operation twice equals applying it once. Most real
operations are weaker than that and still fine: they are *convergent*, meaning the
second run inspects the current state, finds the work already done, and does
nothing. Convergence is the property that matters, and it is the one that survives
a crash, where a strict idempotence argument about the first run does not apply.

The distinction is the difference between "run it twice" and "recover from the
run that died at step four", and only the second one is the real requirement.

## Core values

**Converge, do not resume.** The end state is a function of the desired state and
of what exists now. It is not a function of how many attempts there have been. A
second run that has to be told where the first one stopped needs a resume point,
a progress file, and a way to be wrong about all three.

**The crash point is part of the design.** Halfway is the normal case. An
operation whose behaviour is undefined at each partial point is undefined at
every point, and it will be found at the worst one.

**Reconcile before you act.** Scan the existing state, compare it against the
desired state, then act on the difference. The other order means the operation has
to undo its own work, which is a second implementation of the first.

**Compare by content, not by order.** Creation order is a proxy for identity that
stops being true across a crash, a clock change, or a second machine. Content
equivalence survives all three, and a hash of it survives a moved file.

**A lock is a hint, not a fact.** A lock file records that someone might be
working. A process that died holding it makes the record false, and nothing will
correct it. Every lock needs a way to go stale and a way to notice.

**Assume the duplicate.** On any transport that can drop or retry, a message
arrives more than once. That is not a defect to engineer away, it is the condition
to design against, and the design that assumes it is the one that behaves.

## Strategies

**Answer the three questions before writing the code.** Before, not after. Each
one that cannot be answered in a sentence is a design that is not finished.

**Make the operation a pure function of current state plus input.** If what it
does depends on how many times it ran, there is a counter, and the counter is
state you now own, persist, and reconcile.

**Clean up by content.** "Remove what matches what I just wrote" survives a
restart. "Remove what this run created" does not, because the run is the thing
that crashed and the files outlived it.

**Give the lock an expiry.** A process id, a heartbeat, an age threshold on the
file: pick one and write down which. A lock with no staleness rule converts one
dead process into a permanent outage, and the outage outlives every deploy that
tries to clear it.

**Regenerate the intermediate input, do not cache it.** If one cycle produces
input for the next, produce it again from the source of truth. A cached
intermediate is exactly the state a crash leaves behind, so it is the state most
likely to be the wrong one.

**Prefer a reconciliation step to an error branch.** "If it already exists,
continue" is the cheapest convergence and the worst reporting, because it cannot
tell you whether the existing thing is the thing you wanted. Where that
distinction matters, compare and say.

## Tactics

**Run it twice, back to back, and compare the state.** The cheapest test of this
principle and the one nobody runs. Compare content, not counts: a matching count
can hide different contents.

**Crash it at each step on purpose.** Kill the process between the write and the
rename. Move the crash point one step and run again. This is
`principle-evidence` pointed at a runtime property: a convergence claim nobody has
crashed is a claim, not a fact.

**Answer "what does the second run see" with a listing, not with intent.** What
you believe the second run will find is a hypothesis. What a directory listing
shows is a fact, and it is one command away.

**Find the counter.** Anything that increments across runs, anything that
appends, any timestamp used as a comparison key. Each one is a place where the
second run differs from the first, and each one is a place a crash can leave it
half-written.

**Check that a lock has a staleness rule before you ship the lock.** Search for
the lock's own expiry. A lock whose only rule is "the file exists" is a lock that
outlives its holder.

**Look for the order-based comparison.** "The newest one wins", "the last one
created", "the one from the most recent run". Every one of those is a guess about
history standing in for a fact about content.

## What this principle is not

- **Not a demand for transactions everywhere.** A function that reads and returns
  has no state to reconcile and nothing to converge. This principle is about state
  that outlives the process.
- **Not a licence to add reconciliation to code nothing re-runs.** If no scheduler
  restarts it and no person retries it, there is no second run to converge. The
  code is real and the benefit is zero.
- **Not a claim that exactly-once delivery is available.** It is not, on any
  transport that can drop or duplicate. Design for the duplicate instead of
  waiting for the guarantee.
- **Not a licence to make every operation resumable.** Resumption needs a record
  of where the last attempt stopped, and that record can be wrong in ways
  convergence cannot. Convergence is cheaper here, because it needs no memory of
  where you stopped.
