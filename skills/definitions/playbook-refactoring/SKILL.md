# Playbook Refactoring

Change the structure and hold the behaviour. The contract gets pinned before any
structure moves, every step keeps the pin green, and a reshape that does not
lower the load on whoever reads the code next gets reverted.

`principle-laziness-protocol` states the claim: a hop or a piece of state that
exists for nobody should go. This is the procedure for a change that has to come
out the other side identical in behaviour, and holding that identity is the whole
difficulty. A bug you find along the way is `playbook-bug-fix`; a capability you
realise is missing is `playbook-feature`. Ship the structural change first
against the pinned contract, then the other one on its own branch.

## Start

Open a `todolist` with one entry per phase before touching structure.

1. Pin
2. Target
3. Subtract
4. Move
5. Prove
6. Keep or revert

## Phase A: Pin

Pin the behaviour first, before the shape moves. Run `how` over the affected
subsystem to learn what the contract is, then write a characterization test, a
snapshot, or an equivalence harness that captures current behaviour exactly. If
the area has no coverage at all, writing the pin is the first thing you do, not
a thing you do after the refactor is already convincing you it was safe.

Typecheck and lint are not a pin. Both pass on code that is wrong, and both
happily pass on code whose behaviour you just changed without noticing.

## Phase B: Target

Name the structure the code is missing, in terms of the domain rather than the
file layout. Boring code stays exactly where it is when the shape is already
clear and local. The reshape has to delete branches or invalid states; a reshape
that only adds a hop has not changed anything a reader benefits from.

State what the module layout, the types and the call graph should be if this were
built today, and why. If the target crosses a function boundary, run `architect`
for parallel design exploration of the shape before the move. A boundary crossed
by accident becomes a redesign three phases later, with a pin holding the old
behaviour hostage.

## Phase C: Subtract

Delete before you add. Dead code, one-caller wrappers, redundant validators,
orphan references, a flag with one value. Do this before the new shape arrives,
because subtracting afterwards means reading the new code to find what the old
code was carrying.

Before deleting a comment, a suppression or a gated block, read them.
`tools.spectre.comments` inventories both, and `ripwire.flags` reports what is
built but dark: the feature gate that is always off, the legacy path kept "just
in case". A gated block is a claim someone made about the future, and deleting it
means disagreeing with that claim out loud rather than quietly.

A speculative cleanup that "might help" gets reverted.

## Phase D: Move

Small behaviour-preserving steps, each one keeping the pin green. Run the pin
between steps, not at the end; a step that turns it red has changed behaviour and
is not a refactor.

For an API reshape, migrate every caller and delete the old API in the same wave.
No compatibility shim, no window where both paths exist. Renames are where this
goes wrong: a rename silently misses usages in strings, in prose, in config and
in back-references, so check `ripwire.uses` for the call, read and import sites
and `ripwire.impact` for what the symbol reaches, and grep the docs and config
yourself. `ripwire`'s call edges are name-based, so a count of zero is a floor
and not a proof — a hand-written name in a template string is invisible to it.

Delegate the mechanical edits to a `subagent` with the file paths, the names being
moved, and the behaviour to hold. Choose the model with `tools.spectre.routing({})`.

## Phase E: Prove

Prove the behaviour is unchanged on the real artifact, not by the fact that it
compiles. For a larger reshape, run an equivalence check: a script that diffs
old against new output, a recorded baseline replayed against the new code, or a
smoke run of the thing the module actually does.

The pin from Phase A is the minimum. Where the pin could not capture the
behaviour, say which parts went unverified rather than letting the pin stand in
for them.

## Phase F: Keep or revert

The success measure is a smaller load on the next reader, and it has an
instrument: a `ripwire` quality delta over the branch, which reports what got
worse across complexity, verbosity, nesting, duplication, dead code and API
surface. If the number does not drop somewhere, revert the whole thing. A
refactor that made the file longer and the call graph deeper has not paid, and
`principle-minimize-reader-load` is the claim it failed.

Then rebase into small ordered commits: the subtraction, then the reshape, then
any follow-on cleanup. Order the branch with `tools.spectre.stack` and open it
with `gh pr create`.

## Outputs

The structure that changed, the pin you held it against, the equivalence proof,
the reader-load delta, and what you reverted. Plus the new behaviour, if any,
which should be none.
