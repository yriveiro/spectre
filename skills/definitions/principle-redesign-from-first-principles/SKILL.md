# Principle: Redesign From First Principles

A new requirement gets integrated by asking what the design would be if that
requirement had been there from day one, then moving the code toward the
answer. A bolt-on does the opposite: it keeps the old design and adds a flag, a
special case, or a second path beside it. Each of those looks cheap in the diff
that introduces it, and each becomes a fork every later change has to route
around. After three of them the codebase is the old design plus three
exceptions, and nobody can say what the design is. The cheap change was the
expensive one.

The test is one question with an answer: if we were writing this from scratch
with this new requirement in hand, what would we build? Write that shape down,
then move the code toward it and let the old shape dissolve into the new one. It
does not have to land in one diff. It has to be the direction, stated plainly,
with the first step inside this change.

`principle-laziness-protocol` owns the smaller change and the deletion that
should precede it, and this leaf repeats neither. The difference is the
destination: laziness asks what this change can delete, and this one asks
whether the design it is being fitted into is the design. The moment differs
too. `principle-foundational-thinking` asks that question before any downstream
code exists, which is cheap. This leaf asks it after, when the code is already
here and the answer costs. And `principle-migrate-callers-then-delete-legacy-apis`
owns the commit sequence once the decision is made; the decision itself, that
the old shape is the wrong shape, is made here.

## The moves

**Answer the from-scratch question out loud, before you touch a file.** If we
were writing this today with this requirement in hand, what would we build? The
answer is a shape, and it is a different artefact from the diff you are about
to write. Two sentences is a shape. A paragraph is a mood, and moods do not
redirect a refactor.

**Check whether the requirement is really new before redesigning for it.** Some
of them are a bug wearing a structural costume, some are a missing option, and
some are data the system should have stored in the first place. The from-scratch
question is worth asking for a requirement the design could not have
anticipated, and a requirement the design could have absorbed is a bug report
with extra steps.

**Name the smell in the plan.** A boolean parameter, an `if (mode === "x")`, a
second implementation behind an interface, a nullable column that means "not
finished yet": each is a requirement met beside the design rather than inside
it. Naming which one the plan opens with is the cheapest check there is.

**Count the rent, not the diff.** Every flag makes each caller responsible for
knowing when it is set. The ticket is not the unit that matters. The shape after
ten tickets is, and ten bolt-ons produce a shape nobody would have designed and
nobody can now change without breaking an exception they did not know existed.

**Move the decision rather than add a condition.** A requirement that does not
fit almost always wants something the current design cannot express, and a
branch inside a shape that cannot express it is a second shape with a worse
name.

**Name what the redesign deletes.** A redesign that keeps every existing
special case has not redesigned anything. It has written the old design in a
new file. The list of things that stop existing is the evidence that this is a
redesign rather than a rename.

**Let the old shape dissolve rather than keeping it as a fallback.** Two paths
that both work is a decision nobody made, and
`principle-migrate-callers-then-delete-legacy-apis` sequences that transition
across commits. What that leaf does not decide is whether the old shape deserves
to survive at all.

**Say the target in one sentence and check the diff against it.** A hunk that
cannot be traced to that sentence is a bolt-on with better manners.

**Land the first step inside this change.** A redesign whose first move is a
later ticket is a design document. Direction plus one step is what makes it
real. Direction plus a plan is a document nobody opens twice.

**Redesign the data, not only the code path.** Most bolt-ons land on the data: a
nullable column, a field that means two things, a table keyed by a string that
now needs a second meaning. Ask what the stored shape would be if the
requirement were original, because migrating the data later is the expensive
half of every one of these.

**Separate the decisions from the sediment.** Most of the resistance to a
redesign is an implementation detail nobody chose. Go through the current
shape's properties and mark which are decisions somebody made and which are
accidents that hardened.

**Sort the tests before the refactor, not during it.** A test that pins the
arrangement rather than the behaviour breaks by design when the shape moves,
and deciding what to keep while you are halfway through a move is how a
redesign ends with its assertions deleted wholesale.
`principle-test-behavior-not-implementation` owns which is which. The point
here is that the sorted list belongs to the redesign rather than to a cleanup
after it.

**Do not treat the size of the diff as evidence against the redesign.** It will
be larger than the ticket, and the ticket is not the unit. A large diff is what
a shape change costs. A small diff is what a bolt-on costs, paid on every later
change.

**Redesign to this requirement, not to a better product.** The from-scratch
question is scoped to the requirement in hand. A redesign that also improves
three things nobody asked for is a second change wearing this one's clothes, and
it is the one that gets rejected as a whole.

## What this principle is not

- **Not a licence to rewrite the area.** Reach for this when the current shape
  cannot hold the requirement. When it can, add the case where the case belongs,
  and the small change is the answer.
- **Not a synonym for cleaning up.** A module that has drifted over a year is
  `principle-hygiene` and `principle-laziness-protocol` doing their work. A
  redesign there costs a review of everything and answers a question nobody
  asked.
- **Not permission to change behaviour to make the shape fit.** A redesign that
  alters what the system does is a different change, and mixing the two means
  the diff cannot be reviewed. The shape moves and the behaviour holds, or the
  behaviour change gets its own diff.
