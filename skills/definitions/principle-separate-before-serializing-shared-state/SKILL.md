# Principle: Separate Before Serializing Shared State

Two writers to one place collide, so remove the sharing first and serialize only
what must stay shared. The insistence is about what coordination code costs:
a lock, a queue, an ordering flag, a retry loop each paper over the collision
rather than removing it, so the second writer is still there and the code got
slower on the way to discovering that. This leaf decides who may write at all.
`principle-sequence-verifiable-units` decides in what order the writes land, and
`principle-make-operations-idempotent` asks the separate question of what a
replayed write converges to, which presumes there is a reason to replay one.

There is no single question that proves you did this, and a rule that offered one
would be selling a number. The moment is the whole rule: you are about to add
ordering, locking, or coordination around a shared write target. Stop there and
ask whether the target
has to be shared. If each writer can own its own copy, its own partition, or its
own output, merged later by one reader, do that, and the coordination code never
gets written.

## The moves

**Ask whether the target must be shared before you write the coordination.** You
fixed the timing of the crash, not the fact that two hands hold the same pen. A
lock in front of a target that did not need to be shared is a mechanism with a
lifetime: it has to be taken, released, reasoned about, and remembered at every
future write path, and every one of those is a place the next reader looks.

**Count the writers before you choose a mechanism.** Name every process, thread,
worker, callback, and request that reaches the target now, and every one that
could. One writer is not coordination, it is a single owner and an invariant you
can write in a sentence. Two is a race with a number attached, and the number is
the whole of the analysis.

**Give each writer its own target and merge once at the end.** A file per writer,
a row per writer, a value per writer, an artifact per run, folded by one reader at
a single point. The collision goes from unlikely to unconstructible, which is the
only version of this that stays fixed as the code grows.

**Partition on the axis the data is already independent on.** Writers that touch
disjoint keys need disjoint targets, and the key is usually right there in the
data. A shared map of per-key entries still shares the map, so the ownership has
to be the partition rather than the entry.

**Accumulate, then commit once.** Most collisions in a script are a loop that
writes per iteration where a loop that writes once would do. Build a list, a
buffer, a return value, and let the one writer apply it in a single pass at the
end. Nothing else in the program has to know the loop existed.

**Make the single writer structural rather than a promise.** One queue with one
consumer, one module that owns mutation, one directory nobody else writes to. A
writer that has to remember to take the lock is a second writer with better
manners, and better manners are what a comment provides.

**State the invariant where the lock is taken, and route every write through it.**
"Writes are serialized" written in a comment while a second file writes directly
is the exact bug the comment was written to prevent. The invariant and the choke
point go in the same place, or the invariant is a wish somebody is maintaining
on your behalf.

**Name the order you actually need, and check that a reader can observe it.** If
two writes must land in a particular sequence, name the consumer that depends on
it. If nothing can tell the difference between the orders, the ordering is a
private preference, and the serialization is paying for something no reader asked
for.

**Prefer a write target that cannot be written twice.** An append-only log line,
a new file per run, a content-addressed path: each has no lost update to protect,
because there is no in-place edit to lose. A value that must be kept equal in two
places is the derive-don't-synchronize move, already owned in two other leaves. A
target two writers mutate is the same defect at the level of the write rather
than the value.

**Replace the retry loop and see whether it is still needed.** A retry loop is
coordination you wrote because the target was shared. If it stops firing after the
separation, delete it, and the deleted loop is the receipt that the separation
was real. If it still fires, the separation did not happen and the loop is
earning its keep.

**Do not add a lock to make a test deterministic.** A test that fails only when
two things run at once has shared state in its fixture. Fix the fixture. A
production lock bought to stabilise a test is a permanent cost paid for a
temporary symptom, and the symptom is usually the thing that had a bug in it.

**Check for the second writer with a command before you call it done.** In this
repo `ripwire --uses` on the shared symbol, or a search for the write site's name
across the tree. Coordination is finished when the list of writers is one line
long and it names a function rather than a rule.

**Treat "it is unlikely" as a claim about the schedule rather than about the
code.** Two writers on one thread cannot interleave. Two writers across
processes, promise callbacks, signal handlers, or workers can, and the
interleaving is not rare, it is merely unobserved on the machine where you are
standing.

## What this principle is not

- **Not "no locks anywhere".** A single-writer invariant on a resource several
  processes can reach is a real constraint, and one mutex at one choke point is
  the cheapest honest expression of it. The question is whether the sharing
  survived being asked about, not whether coordination exists.
- **Not the end of the idempotence question.** Separating the writers removes one
  reason to replay a write and answers none of them. What the second run
  converges to, and what happens if the first died halfway, is
  `principle-make-operations-idempotent`, and it still has to be answered.
- **Not a licence to duplicate and reconcile forever.** Two copies of one truth
  with nobody named to own the merge is this failure with a longer fuse. If the
  merge is real work, that is a cost to state out loud, not one to schedule
  quietly.
- **Not permission to keep the coordination that is no longer needed.** A lock
  left in front of writers that no longer collide is a mechanism whose only
  remaining function is to be maintained, and the next person will read it as
  evidence that the collision is still there.
