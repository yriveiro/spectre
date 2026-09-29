# Principle: Model The Domain

A domain rule that lives in a structure gets checked, and the same rule living
in conditionals gets remembered. So the move is to take the decision a chain of
branches is making, give it a name, and put it somewhere the compiler, a
lookup, or the file layout can enforce: a state machine, a table, a union, a
module organized around the body of knowledge rather than around the sequence
of steps. The test is a new feature that grows an existing `if/else` by one
more branch.

The failure is not a wrong branch. Every one of them reads correctly on its own,
and the decision is reasonable each time it is made. What is missing is that
nobody wrote the decision down, so there is nothing for the seventh case to be
wrong against. Three of the six sites get updated, the fourth ships, and the
bug report describes a value that should not have been possible. Nobody reasoned
badly. The shape of the thing was never written, so nothing could check it.

`principle-make-states-unrepresentable` holds the same claim at a smaller
unit, and keeping the two apart is what stops both from being restated here.
That leaf is about one value: a bag of optional fields that admits a
combination nobody can explain, replaced by a sum type or a branded primitive
so the compiler rejects it. The union move, the branded id, and the "ask
whether you can write the comment" test belong to it and are not repeated
below. This leaf is about one decision that lives in several places at once.
Six files asking `status === "done"` is the same rule six times, and no type on
a single value reaches it.

What is left is the half that leaf does not hold: which structure, and what
each one deletes. A union removes a bad combination inside one value. A table
removes a chain of comparisons across a file. A state machine removes a set of
flags and the ordering question that comes with them. A module named for the
domain rather than for its steps removes a rule restated once per phase. These
are not four phrasings of one thing, and choosing the wrong one leaves the
chain intact with an indirection standing in front of it.

## The moves

**Ask what the second case is before you name the structure.** A single branch
with one reader is a check. The moment a second case exists that the first
branch did not anticipate, the cases are a set, and a set wants one home.

**Count the sites that repeat the decision before you write anything.**
`ripwire --whereis "status ==="` puts the number in front of you. One site is a
check, five is a rule with no address, and the number is the argument for the
change.

**Name the decision, not the branch.** "What is it the branches are all
asking?" has an answer, and the answer is a noun: pending, shipped, refunded.
The name is what a table gets keyed on, what a state is, and what a module is
called after.

**Turn a chain of string comparisons into a table keyed on a closed set.**
`Record<Status, Handler>`, where `Status` is a union of the literal strings,
removes the chain, and a new case becomes one entry rather than one branch in
six files.

**Keep the table and its key in the same file.** A `Status` union in
`types.ts` and a `Record<Status, Handler>` in `handlers.ts` is two edits per
case and one place to forget the new member. A table keyed on `string` is not a
table. It is a chain wearing a lookup.

**Leave the fallthrough out so a new case is a compile error.** An exhaustive
`switch` on the union, a `never` check in the default, a `Record` with no
optional members: each turns "somebody forgot" from a bug report into a build
failure at a named line. A `default:` that swallows the unknown case deletes
the only thing the structure was for.

**Turn scattered lifecycle flags into a state machine with declared
transitions.** `isActive`, `isComplete`, and `isArchived` admit combinations
that mean nothing and combinations that contradict. One current state plus one
place that says what each transition does removes both, and removes the "what
happens if both are set" question every reader re-asks.

**Choose snapshot or transition by whether the order matters.** A `phase`
string records where something is. A state machine records where it may go
next, which is the fact the code has to enforce. Take the snapshot when nothing
depends on the sequence, because a transition table costs more to keep in step
than it saves.

**Name the module for the thing it knows, not for the step it performs.**
`load`, `validate`, `transform`, `save` describe a sequence, and a rule that
belongs to one body of knowledge gets restated in each of them. A module named
for the subject puts the rule at one address, and execution order is not
ownership.

**Take the rule out of prose and into the structure.** A rule living in a
comment, a README, or the invariant every reviewer holds in their head has
nowhere to live. Structure is how prose becomes something a search finds and a
compiler can check.

**Name each case in the domain's words.** `"done"` and `"archived"` are
different states. `3` and `"complete"` are the same state with a history behind
it. When the domain's word changes, the compiler finds every site; a search
finds some of them.

**Delete the chain the structure made unreachable.** The old comparisons stay
behind, still correct-looking, and they keep an answer available to the next
reader. The change is not finished while the old branch compiles.

**Prefer the structure that deletes the most decisions, not the most lines.** A
large table that replaces six branch chains and adds forty lines is a
reduction. A small abstraction that adds a hop and leaves the branches in place
is a layer, and whether an indirection earns its keep is
`principle-laziness-protocol`'s question. This one is which structure, and what
each one removes.

## What this principle is not

- **Not a licence to model one flag.** A single boolean with a single reader is
  a check, and wrapping it in a state machine is the clutter
  `principle-laziness-protocol` exists to refuse. The line is whether removing
  the branch would delete the structure along with it.
- **Not a branch count.** There is no threshold at which an `if/else` becomes a
  model. Two branches deciding the same question are a table. One branch asking
  two unrelated questions is two checks and nothing else.
- **Not a table of code.** Rows that each need their own guard, their own
  error, or their own side effect are code wearing a table's clothes, and the
  chain is now spread across the row bodies. If the cases do not share an
  operation, the cases are not a set.
