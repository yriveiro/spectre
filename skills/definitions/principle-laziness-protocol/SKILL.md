# Principle: Laziness Protocol

Laziness is one question asked twice. When the code already exists, ask what work
it imposes on whoever reads it next, and cut a hop or a piece of state. When the
code does not exist yet, ask what a deletion would have avoided, and do that
instead. Same question, two moments, and the second one is cheaper because it
answers the first before there is anything to read.

The reason this is one principle and not two is that the reader is whoever
consumes the work, and the agent is one of them. The agent reads every file in
every session, with no memory of writing it, and that is the same position as the
colleague who imports the library or the person who maintains it next. An API that
is pleasant to call and miserable to maintain has moved the cost rather than
removed it. So the discipline is not about people. It is about not spending
attention that is not yours to spend.

The reader-load half is the one with an honest measure, and it has exactly two
axes: layers to trace, which is how many hops sit between the reader's question
and the answer, and state to hold, which is how much hidden or mutable context
they must carry while they read. The axes are independent, and that is the part
worth keeping. A flat file with fifty globals can cost as much as a six-layer
adapter stack. Code that is short is not the same as code that is easy to follow.
Only the first is a proxy, and it is the one everybody measures.

The moment-before half has no measure, and it is the one that saves the most. A
signal you have been told to thread is a design question, because a value that
crosses three layers to reach one decision is that decision in the wrong place.
Move the decision and the plumbing stops being needed. That question has an
answer, which is what makes it worth asking before any code exists.

The reader half is the human counterpart of `principle-guard-the-context-window`.
Same shape, different payer: that skill guards the tokens the agent spends, this
one guards the attention every reader spends. The two never compete, because
routing a payload to a subagent to shorten your own work is not a way to shorten
the reader's.

There is a third surface, and it is the one this principle is easiest to forget:
the response itself. Both axes apply to a message. A conclusion stated on the
first line and re-derived on the twelfth is two hops. Five nouns introduced and
never resolved are state the reader carries until the end.

Reader load is not a number, and the difference matters. LOC, cyclomatic
complexity, and clean architecture are all measurable and all wrong as goals. They
correlate with reader load often enough to be worth keeping as alarms, which is
the only job they should do.

## The moves

**Ask what you would delete before you ask what you would add.** That question has
an answer, which is what makes it worth asking. "Is this clean" has none, so it is
never settled. List what the change can delete, then list what it must add, because
doing it in the other order makes the addition feel necessary: it is the only one
on the page.

**Read the task's verbs.** "Thread", "pass through", "expose", "surface" all name a
shape. A task that names the shape has skipped the decision you would have made,
so make it before the plumbing is built.

**Ask where the signal comes from.** A parameter that crosses three layers to reach
a single decision is a decision placed too far from its data. Take the decision to
the data and the plumbing stops being needed. This is the one strategy here that
no other leaf in the set owns.

**Answer the two questions before you leave the code.** Pick a value the reader
will ask about. Answer "where does it come from" and "what can change it" out
loud. The place you had to look is the load you imposed, and if it took more than
one hop it will for everyone who did not write it, including you in a week.

**Every layer must pay for itself.** Name what a hop hides. A layer that hides a
real decision is load reduction, because the caller does not have to know the
decision, and that is the entire point of a boundary. A layer that hides nothing is
a toll. Collapse a wrapper with one caller, an adapter with no second
implementation, a module that re-exports under a new name: each adds a hop and
removes nothing.

**Collapse the layer that does not change the abstraction.** If the next layer
takes the same arguments and repeats the same methods, the reader learned the
interface and then had to learn the implementation too, which is strictly more
work than reading the implementation. A pass-through layer is not compression.

**Prefer a boundary that hides a decision to one that hides a shape.** A broad
interface over one implementation makes the reader learn the surface and the
implementation both. Narrow it until it names the decisions the caller must not
make. A boundary with two implementations, a test seam, or a decision the caller
should not be making is doing its job, and the target is the boundary that hides
nothing, not the boundary.

**Keep state as narrow as you can.** Every value the reader must remember is
carried for the whole file, function, or request. Prefer, in this order: a pure
function's return value, then a local, then a field, then module state, then a
global. Each step down widens the scope in which the value can change, and each
widening is a question the reader now has to hold the answer to.

**Derive, do not synchronize.** Two copies of a value need a rule keeping them
equal, and the rule is invisible at both sites. Compute the second from the first
and the question goes away. This shape is where synchronization bugs live, and it
is also where the reader's work lives.

**Name the invariant once, at the boundary, and name the decision there too.** An
invariant restated in every consumer is load multiplied, and a choice repeated in
four call sites is a decision four readers have to re-derive. One sentence in one
place is worth four call sites that do not repeat it.

**Reject the parameter that only crosses a layer.** If a value enters a function,
passes through unchanged, and leaves, the layer is the cost. Make it a field of
something the caller already has, or delete the layer.

**Take the flat shape when both are correct.** If a helper exists so a second
caller can reach one line, put the line where both callers already are. Two hops
saved, no decision lost.

**Prefer the shape that needs no explanation.** Where two shapes are equally
correct, take the one a reader understands without a comment. A comment that
exists because the shape was unclear is a record of a simplification that did not
happen.

**Count the hops instead of arguing about the code.** A reader's question has one
answering site, and the number of files between them is the layer count. Use a
command that draws it, and do not reason about it from memory, because the memory
is the thing most likely to be wrong. In this repo `ripwire` names the command
(`--callers`, `--uses`, `--context-ratio`, `--nonlocal-state`), and the rule stays
generic so the principle outlives any one tool.

**Count the callers before collapsing, and keep the three cases apart.** Zero
callers means the layer is dead, which is `principle-hygiene`. One caller means
the abstraction is unproven. One caller that only forwards is this principle.
Keeping them apart is what stops one pass doing the other's work.

**Ask what the reader must hold to reach the end.** Name every thing a response
introduces and does not resolve: a file, a version, a variable, a constraint, an
open question. Each one is carried until it is resolved or dropped. Introduce a
thing next to where it gets resolved, or resolve it before introducing the next.
An open item at the bottom of a long message is the most expensive sentence in it.

**Count the files the change touches before you write it.** A plan that reaches
four files to deliver one behaviour is the plan telling you something. The number
is the honest report of what the change cost.

## What this principle is not

- **Not "fewest files wins".** Collocating code across a real boundary makes it
  shorter to read and impossible to change. Layer count is a cost, not the
  objective. Some code has to be deep because the problem is deep, and the
  question is whether the depth is doing work, not whether it exists.
- **Not an arbitrary depth threshold.** "More than three layers, flatten it" is a
  number with no evidence behind it, and a repo with a different call depth would
  fail it for no reason. The question with an answer is what each hop hides.
- **Not a licence to refactor what you were not asked to touch.** A drive-by
  collapse inside a bug fix is scope creep wearing this principle as a hat.
  Change the shape when the shape is the work, and not while you are standing
  near it.
- **Not "delete before you understand".** Deleting the wrong thing costs more than
  keeping it. Establish what reaches the thing first, which is
  `principle-evidence` answered by `ripwire`, and then delete.
- **Not a licence to shrink the task you were given.** The smallest change that
  solves the problem is the change that solves the problem. A fix that leaves the
  bug reachable is not a small fix, it is an unmerged one.
- **Not "fewer lines beats clearer ones".** A shape that is compact and
  incomprehensible saves a line and spends the reader's whole afternoon. Decodable
  beats short, and that brake is `communication`'s to apply.
- **Not a number.** Reader load is not a score, but it is countable:
  `ripwire --context-ratio` reports the hops a reader must cross and how much of
  the knowledge sits outside the file they are in, and `--nonlocal-state` reports
  the mutable state a function can reach. Both are instruments rather than gates,
  so run them and read what they say.

