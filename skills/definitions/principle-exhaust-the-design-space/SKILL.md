# Principle: Exhaust The Design Space

For a decision with no precedent, the first design is a guess, and a guess
presents its first answer with total confidence. You build it out, and by the time
its flaws show, the code is load-bearing and the flaws are architecture; redesign
then means a rewrite, so the flaws stay, annotated as trade-offs nobody ever
traded, and the team inherits a guess wearing the authority of shipped code. So
build two or three competing prototypes, compare them on the same evidence, and
only then commit, because a design chosen from one option was never chosen. There is no count to
pass and no gate to clear, because the whole rule is a moment, novelty with no
precedent where being wrong costs more than two throwaways. The comparison itself
is `principle-evidence`'s oracle; this leaf is the workflow that builds the oracle
before the commitment rather than after the failure.

## The moves

**Establish that the decision is actually novel, with a search.** Novelty is a
claim about the codebase, and the check is a grep for a shape, a module, a
dependency, or prior art already in the tree. If something answers the question,
this is `principle-laziness-protocol`'s question — reuse before you invent — and
the throwaways are spent for nothing.

**Write the decision in one sentence before sketching anything.** A design session
that has not written the decision down produces three prototypes of three different
questions, and the comparison at the end is between answers to different questions,
which settles nothing while producing all the cost.

**List the options before you build any of them.** Two or three, named, each with
what it would cost and what it would buy. Options discovered after the first one is
built are options selected to lose, and the list is what makes the choice legible
to the next reader.

**Prototype at the altitude the decision lives at.** Two screen designs compared
as code, or two libraries compared as feel, are both mismatches. Build the
comparison where the trade-off actually shows up, even if that means a throwaway
interface rather than a real one.

**Make each prototype real enough to fail.** Runnable, or sketched to the same
depth against the same cases. A prototype too thin to fail proves nothing and
flatters the favourite, because the favourite is the one you already know how to
build.

**Run the same cases through all of them.** Fit, cost, and failure modes, side by
side, in writing. A different corpus per option is a story rather than a
comparison, and `principle-evidence`'s same population before and after is the rule
that keeps the result a comparison.

**Push each prototype at the case it is least comfortable with.** The cheapest way
to kill an option is the one it was designed around. An option that survives its
worst case has been decided; one that dies on it was never going to ship, and
finding that out now is the entire return on the throwaway.

**Include the option you are not tempted by.** The obvious alternative is the one
nobody writes down, because it already sits in everyone's head as a position
rather than as an option. It is also the one that wins a surprising share of the
time, and leaving it out turns the comparison into a formality with a paper trail.

**Timebox the throwaways, and watch for the moment one turns into a product.** A
prototype that starts accumulating tests, handlers, or callers has stopped being a
comparison and started being a commitment. That is the signal to stop building and
pick, because from there the options stop being equally cheap to abandon.

**Keep the prototypes somewhere a reader can throw them away.** A scratch branch, a
directory, a spike under an obvious name. A prototype built on the product path
starts accruing callers, and abandoning it turns a design decision into a
migration nobody budgeted.

**Score reversibility alongside the rest.** How expensive is it to undo this in
three months: delete a module, or unwind a data shape, a public interface, or a
convention other code now depends on. An option that is cheap to reverse can be
tried in production before it is fully understood, and that changes which option
is safest to start with.

**Write the comparison down, including what lost and why.** The record is what stops
the decision being relitigated every quarter, and it is the only artefact that
tells the next person which options were already considered and what each one
would have cost.

**Commit only after the comparison exists.** This is the step that gets skipped,
because the favourite already feels chosen. Committing is where the last option is
lost, and after the commit the alternative is a rewrite, so whatever the guess got
wrong stays, documented as a trade-off.

**Name the questions the prototypes could not answer.** Novelty has a horizon. A
comparison that settles three unknowns out of five is still worth running, as long
as the two it ignored are written down rather than quietly assumed to be fine.

## What this principle is not

- **Not a licence to prototype everything.** Three throwaways cost real time and
  teach the codebase nothing when the decision was settled by a grep. The condition
  is novelty plus a cost of being wrong that exceeds the cost of the throwaways.
- **Not a demand for prototypes where an oracle already exists.** If the upstream
  tool, a benchmark, a schema, or the specification knows the answer, ask it: that
  is one command, and it is `principle-evidence`'s instrument, not a prototype.
- **Not an indefinite deferral.** Building three is half the work; choosing is the
  other half. A comparison that ends without a pick has turned one expensive guess
  into three cheap ones and a fourth attempt later, against a tree that has moved
  and no longer fits any of them.
- **Not a redesign of a working system in the name of exploring.** The prototypes
  belong outside the shipped path. A design that reaches production before it is
  compared has skipped the step this principle exists for, and the comparison
  afterwards is a rewrite wearing a report.
