# Principle: Foundational Thinking

Most hard work is hard because the ground under it is wrong. The data is shaped
for yesterday's question, the scaffold assumed one caller and now has six, and
every new task begins by negotiating with decisions nobody remembers making. This
principle says get the data structures and the scaffold right first, while they
are still cheap to change, and the rest of the work turns obvious rather than
inherited. Effort spent on the foundation pays every later phase. Effort spent
downstream, on a bad foundation, pays once and charges interest. It is adjacent to
`principle-make-states-unrepresentable`, which owns which shape to reach for once
you have decided to reach for one. This leaf owns when, and what the early
decisions are that the late phases will be living inside.

The test is forward-looking and it is the only one: does every subsequent phase
benefit from this existing, and can you name one that does. Naming the phases is
what turns the question from a feeling into an argument, because a foundation with
no named beneficiary is a monument, and a scaffold that assumes the answer has
already spent the option value it was meant to protect. A small single-step task
has no phases and does not need any of this. Reach for the principle when the
work has phases and the early ones constrain the late ones, which is exactly when
it is cheapest and exactly when it is most often skipped.

Without it, each phase re-decides what the last one left vague. Types drift,
adapters multiply, and the fifth task costs triple the first because it carries
the four workarounds the earlier ones installed. The symptom is a plan where every
step is a negotiation: nothing composes, nothing is obvious, and each addition
needs a paragraph explaining how it fits. That paragraph is the missing foundation
asking to be written first, and writing it later costs more every time it is
deferred.

## The moves

**Name the phases that come later, and at least one beneficiary.** The test is
whether you can say what gets easier because this exists. Write the names down
before the structure, because a structure with no named beneficiary is a monument
and monuments are what this principle is against.

**Decide the ground while it is still cheap to change.** Data shapes, module
seams, the scaffold everything else hangs on. The price of a decision rises with
everything built on top of it, so the moment a decision is a sentence is the
moment it should be made, and the moment it is a migration is the moment it was
missed.

**Spend the foundation on what is expensive to reverse.** A name, a file layout, a
dependency direction, a boundary between two domains: cheap on day one and
expensive on day forty. A field name, a local variable, a loop body: neither. The
foundation is where the irreversible decisions go, and it is the only place where
they are still free.

**Shape the data for the question you expect, not the one you were asked.** A
record shaped for yesterday's question makes every new task begin by
reconstructing what it did not anticipate, which is a cost paid in code rather
than in a meeting. The question is not which design is best but which one the
next three tasks will fit into.

**Put the domain rule in a structure rather than in prose.** A rule that lives in
a shape cannot be forgotten by the phase that did not write it.
`principle-make-states-unrepresentable` owns which shape to reach for; the claim
here is the timing, which is that the shape is decided before the first consumer
exists, because a shape decided afterwards is a shape decided by accident.

**Write the seam before the second implementation exists.** A seam designed after
two callers are in place has been designed by their common accident, and the
thing both callers share is exactly the thing neither needed. One real consumer
first, then the seam that names the decision it must not make.

**Keep more than one future cheap.** A foundation that picks one path where two
were plausible has spent the option it was supposed to protect. The tell is a
scaffold named after a future nobody has agreed on, and the cost is that the
second path is now a rewrite rather than an addition.

**Name modules after what they own, not after the order things happen in.** A
module called load, validate, transform, save describes a sequence, and the same
domain rule gets restated in each step. A module named for the body of knowledge
it holds gives the next phase somewhere to put a change that is not a phase. The
same claim at the type level is `principle-make-states-unrepresentable`'s.

**Make the handoff between phases a contract.** If phase two cannot be written
without reading phase one's code, the phase boundary is fiction and the interface
is an accident. Write the shape phase two will pass and let it disagree with what
phase one actually produces, because a disagreement found now is a decision and
the same disagreement found in month three is a rewrite.

**Count what the next phase has to decide for itself.** Every decision the
following phase must re-make is one you did not settle, and the count is the
honest measure of the foundation. Two is fine. Twelve means the plan has a step
nobody wrote down.

**Let the first real consumer be the report card.** Build one caller on purpose
and see how much of it had to be written around the shape. That friction is the
foundation's evaluation, and it arrives while the foundation is still cheap, which
is the only time an evaluation is worth running.

**Delete what the new structure replaces, in the same change.** A foundation that
leaves the old path in place makes every later phase pay for both, and the first
phase is the last one that can afford to remove it. Deciding to remove is
`principle-laziness-protocol`'s; sequencing the removal with the replacement is
this leaf's, because the two together are the only moment the redundancy is
visible.

**Write down the decisions the next phase must not re-open.** A short note naming
the reason, in the repository, is what turns archaeology into inheritance. The
reason matters more than the answer: an answer without its reason is re-derived
the moment the situation changes, which is the moment you needed it.

**Do not generalize before the second case exists.** Scaffolding for a caller you
do not have is a monument with a plan attached, and it is the same mistake as
building for a future state that has not arrived. One caller, then the seam.

## What this principle is not

- **Not a phase of its own.** The foundation is decided inside the first phase and
  proved by its first caller. A foundation delivered as a document nobody builds
  on is a plan that survived one more week than it should have.
- **Not a substitute for knowing the domain.** You cannot shape for a question you
  have not seen, and pretending otherwise produces a foundation for a domain that
  does not exist. The claim is about ordering and reversibility, not about
  predicting what comes next.
- **Not a licence to rebuild the foundation instead of doing the task.** When a
  task arrives and the ground is wrong, fixing the ground is a real change with
  its own cost and its own review. Sometimes that is the right call. Rebuilding
  first and letting the task wait is scope creep wearing a principled hat.
