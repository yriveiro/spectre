# Architect

Settle the types, the signatures and the module shape before any code exists,
with bodies marked `not implemented` and the tricky logic left as pseudocode.
Fill the code in against the sketch you chose. When the implementation keeps
producing friction the sketch cannot absorb, throw the sketch out rather than
bolting fixes onto a wrong shape.

`principle-make-states-unrepresentable` owns the finished type that cannot hold
a wrong value. This owns the moment before any code exists, when the shape is
still a sketch and discarding it costs nothing.

## Start

Open a `todolist` with one entry per phase before starting.

1. Ground
2. Sketch
3. Agree
4. Fill in
5. Scrap

## Phase A: Ground the problem

Build a real model of every system the new code touches: `ripwire.explore` for
the ranked map, `how` for the trace behind it. Naming a file is not grounding.
Then read `tools.spectre.history` on the files the design will touch, because a
commit body is the only place a constraint nobody wrote down still survives.
Name what the sketch has to honor — types to interop with, callers you cannot
break, invariants that already crossed the boundary you are drawing.

Skip this phase only for genuinely greenfield work with no surrounding system to
integrate.

## Phase B: Sketch

Run `arena` with the design-skeleton task and the Phase A constraints. Each
candidate produces the same package, in this order:

1. **Usage first.** The README lines or call sites a consumer reads, with two or
   three realistic ones, before any type is written. The sketch is derived from
   the usage, and where they disagree the usage wins.
2. **Data structures**, then the flow through the signatures. Trace each
   dominant access pattern through the structure; "we will add a map later" is
   the answer that means it is wrong.
3. **The module map**, with what each module owns.
4. **The rationale**: problem, shape, tradeoffs accepted, at least one
   alternative and why it lost, open questions, first thing to build.

Require two structurally distinct candidates before synthesis, even when the
first looks sufficient, and prefer answers that differ in whole shape rather than
in a point fix. That is `principle-exhaust-the-design-space` made concrete. Two
candidates that agree prove little, so take the runners from
`tools.spectre.routing({})` on different families, never a model id from memory.

Screen every candidate before synthesis. Four red flags disqualify a shape:

- **A shallow module**: a large interface hiding little complexity. Callers
  coordinating several methods for one operation, or public options exposing
  internal stages, are the tells. A deep call chain is not a deep module.
- **Information leakage**: a representation, policy or protocol detail living in
  more than one module, so changing it needs coordinated edits. Wire and
  transport types stay private; parse into domain types behind the interface.
- **Temporal decomposition**: modules named `load`, `validate`, `transform`,
  `save`. That is an execution order, not knowledge somebody owns.
- **A pass-through method**: the same arguments forwarded on. Keep a boundary
  only when it adds policy or adaptation.

Compare what survives on interface depth: how much complexity the public surface
hides relative to its size. Prefer the smaller surface, even when the
implementation behind it is less simple. Whether that indirection is earned is
`principle-laziness-protocol`'s question, and this is where the answer is yes.

## Phase C: Agree

Default is straight into Phase D. Pause and show the sketch only when the caller
asked for that in as many words. When they push back on the shape, treat it as
Phase A evidence: re-ground and re-sketch before writing more code.

The sketch can ship as its own commit either way, which is
`principle-foundational-thinking` in its scaffold-first form. Breakage planned
and scoped during fill-in is fine.

## Phase D: Fill in against the sketch

Replace the `not implemented` bodies with code and the pseudocode with logic.
The sketch is the contract.

A deviation is signal, not friction to absorb silently. When a function needs a
parameter the sketch did not anticipate, decide which of three it is: the
sketch was wrong, a requirement was missed, or the implementation reaches past
what was asked. Write the answer down; recurring ones are Phase E evidence.

## Phase E: Scrap the sketch

The signal is a pattern, not a single occurrence:

- the same shape of workaround reappearing across unrelated code
- several unrelated edge cases each needing their own branch
- types needing `any`, a cast, or an optional field always set, to compile
- the "we need a lock" reflex when the sketch said nothing was shared
- callers having to know the abstraction's internal rules to use it
- two deviations of the same shape out of Phase D

A few edge cases condemn nothing, and complexity in the data is not complexity in
the design. Judgement still decides.

To scrap: re-run Phase A over what exists now, redesign as if the new
constraints were day-one assumptions
(`principle-redesign-from-first-principles`), subtract before you add so the new
sketch is smaller before it grows, then return to Phase B. Fix the cause, not the
patch (`principle-fix-root-causes`).

## Outputs

The usage written first and the types derived from it: one file of new types and
signatures for a small change, a module map plus type definitions for larger
work. The rationale beside it: problem, usage, shape, tradeoffs accepted,
alternatives considered and why each lost, open questions, the next step, and
the synthesis decision naming the base and what each candidate contributed.
