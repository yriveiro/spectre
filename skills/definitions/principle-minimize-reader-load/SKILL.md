# Principle: Minimize Reader Load

## What this principle is

Reader load is the work a person does to understand code. It is the one
maintainability measure that is not a proxy, and it has exactly two axes:

1. **Layers to trace.** How many hops sit between the reader's question and the
   answer.
2. **State to hold.** How much hidden or mutable context they must keep in their
   head while they read.

The axes are independent, and that is the part worth keeping. A flat file with
fifty globals can cost as much as a six-layer adapter stack. Code that is short
is not the same as code that is easy to follow, and neither is the same as code
that is easy to change. Only the first is a proxy, and it is the one everybody
measures.

This is the human half of `principle-guard-the-context-window`. That skill
guards the tokens the agent pays. This one guards the attention the reader pays.
Same shape, different payer, and the two never compete: routing a payload to a
subagent to shorten your own work is not a way to shorten the reader's.

There is a third surface, and it is the one this principle is easiest to forget:
the response itself. Both axes apply to a message. A conclusion stated on the
first line and re-derived on the twelfth is two hops. Five nouns introduced and
never resolved are state the reader carries until the end.

`i-have-adhd` already holds the layers half on a response. Rules 1 to 3 are the
collapse: the action first, the steps numbered, the next action named. The state
half is not covered anywhere. A message can obey every rule in that file and
still hand the reader six open items to hold at once, because every rule in it
operates on a sentence or a list and none of them operates on the whole. A
person reading a response has the same finite budget an agent has a context
window, and it fills up the same way.

Reader load is not a number, and the difference matters. LOC, cyclomatic
complexity, and clean architecture are all measurable and all wrong as goals.
They correlate with reader load often enough to be worth keeping as alarms, which
is the only job they should do.

## Core values

**A layer must pay for itself.** Every hop a reader traces was added by someone
for a reason, and the reason may no longer hold. Before a layer stays, name what
it hides. A layer that hides a real decision is load reduction, because the
caller does not have to know the decision. That is the entire point of a
boundary. A layer that hides nothing is a toll.

**State has a cost that compounds.** Every value the reader must remember is
carried for the whole file, function, or request. Prefer, in this order: a pure
function's return value, then a local, then a field, then module state, then a
global. Each step down widens the scope in which the value can change, and each
widening is a question the reader now has to hold the answer to.

**Derive, do not synchronize.** Two copies of a value need a rule keeping them
equal, and the rule is invisible at both sites. Compute the second from the first
and the question goes away.

**Name the invariant once, at the boundary.** An invariant restated in every
consumer is load multiplied. State it where the value is produced and let the
consumers trust it.

**The test is a question with an answer.** "Is this clean" cannot be answered, so
it is never settled. "Where does this value come from, and what can change it" can
be answered, in a sentence, by someone who has never seen the file.

## Strategies

**Collapse what only forwards.** A wrapper with one caller, an adapter with no
second implementation, a module that re-exports under a new name: each adds a hop
and removes nothing. Inline it. This is the case the principle is named for, and
usually the cheapest one to fix.

**Collapse the layer that does not change the abstraction.** If the next layer
takes the same arguments and repeats the same methods, the reader learned the
interface and then had to learn the implementation too, which is strictly more
work than reading the implementation. A pass-through layer is not compression.

**Prefer a boundary that hides a decision to one that hides a shape.** A broad
interface over one implementation makes the reader learn the surface and the
implementation both. Narrow it until it names the decisions the caller must not
make.

**Shrink the scope of what you add.** Before a new field, module-level cache, or
singleton, ask what it would take to be a local or a return value. Every step up
that list is permanent, and every step down is free now.

**Answer the two questions before you leave the code.** Pick a value the reader
will ask about. Answer "where does it come from" and "what can change it" out
loud. The place you had to look is the load you imposed. If it took more than one
hop, it will for everyone who did not write it.

**Prefer the shape that needs no explanation.** Where two shapes are equally
correct, take the one a reader understands without a comment. A comment that
exists because the shape was unclear is a record of a simplification that did not
happen.

## Tactics

**Count the hops instead of arguing about the code.** A reader's question has one
answering site, and the number of files between them is the layer count. Most
repos have a command that draws it. Use it, and do not reason about it from
memory, because the memory is the thing most likely to be wrong. In this repo
`ripwire` names the command, and the rule stays generic so the
principle outlives any one tool.

**Check the caller count before collapsing.** Zero callers means the layer is
dead, which is `principle-hygiene` and not this skill. One caller means the
abstraction is unproven. One caller that only forwards is this skill. Keeping the
three apart is what stops one pass doing the other's work.

**Delete the parameter that only crosses a layer.** If a value enters a function,
passes through unchanged, and leaves, the layer is the cost. Make it a field of
something the caller already holds, or delete the layer.

**Find state written in one place and read in another.** That shape is where
synchronization bugs live, and it is also where the reader's work lives. Derive
it, or move both ends next to each other.

**Name the decision at the boundary, not at each caller.** One sentence in one
place, which four call sites then do not repeat.

**Ask what the reader must hold to reach the end.** Name every thing a response
introduces and does not resolve: a file, a version, a variable, a constraint, an
open question. Each one is carried until it is resolved or dropped. Introduce a
thing next to where it gets resolved, or resolve it before introducing the next.
An open item at the bottom of a long message is the most expensive sentence in it.

**Ask the question in the review, out loud.** A reviewer who cannot say where a
value comes from is the cheapest detector of reader load there is, and it costs
nothing to run.

## What this principle is not

Guards against the failure mode of every principle, which is becoming a ritual
performed for its own sake.

- **Not an argument against interfaces.** A boundary with two implementations, a
  test seam, or a decision the caller should not be making is doing the job this
  principle asks for. The target is the boundary that hides nothing, not the
  boundary.
- **Not "fewest files wins."** Colocating code across a real boundary makes it
  shorter to read and impossible to change. Layer count is a cost, not the
  objective.
- **Not a licence to refactor what you were not asked to touch.** A drive-by
  collapse inside a bug fix is scope creep wearing this principle as a hat.
  Change the shape when the shape is the work.
- **Not a measure of the reader.** Some code has to be deep because the problem
  is deep. The question is whether the depth is doing work, not whether it exists.
- **Not a gate.** Nobody runs a reader-load check. A linter can count hops and
  cannot tell whether a hop is earning them, so a lint rule here would enforce
  the wrong thing.
