# Interrogate

Put one artifact in front of several reviewers on different models and let them
try to break it. Then sort what comes back.

This is not `arena`. Arena hands one task to several models and what leaves is a
synthesis, so the picking is the work. Interrogation already has the artifact and
hands that same artifact to several reviewers, so the finding is the work. Same
fan-out, opposite direction: one answer in, many verdicts out.

## Start

Open a `todolist` with one entry per phase before launching anything.

1. Fix the scope
2. State the intent
3. Cast the seats
4. Write the brief
5. Fan out
6. Sort the returns
7. Lead the judgment

## Phase A: Fix the scope

Decide what is under review: the diff the caller pointed at,
`git diff main...HEAD` for the whole changeset on a branch, or the files behind a
question about recent work. Package it with what a reviewer needs to trace a claim,
which is callers, type definitions and sibling modules. A bare diff makes reviewers
guess, and guesses come back as findings.

## Phase B: State the intent

One paragraph saying what the change is for, derived from the caller's message,
from `tools.spectre.history` on the touched files for the reason the surrounding
code is already shaped that way, and from the code itself. If you cannot state it
in a paragraph, ask before spending the run. Every reviewer reviews the execution
against it, so do not invite them to argue the intent.

## Phase C: Cast the seats

Call `tools.spectre.routing({})` and take one reviewer per model, from different
families. Diversity is the whole instrument: two reviewers on one family share its
blind spots and their agreement is close to no signal. If the table offers one
family only, say so before you spend the run. Never write a model id from memory.

Do not assign personas. A lens per reviewer gets you the union of one model reading
everything, which is what asking that model once would have given you.

## Phase D: Write the brief

One brief, byte for byte the same, to every reviewer: the intent paragraph, the
artifact with its context, the lenses below, and the shape a finding takes. Pick
the lenses that apply. A one line bug fix does not need architectural integrity.

- **Correctness.** Boundary inputs, swallowed errors, stale state, what happens if
  this runs twice, and whether two writers are serialized by structure or by
  convention nobody will hold.
- **Root cause or symptom.** A guard clause, a retry, a cast. Ask why the workaround
  is needed and what the real fix would be.
- **Structural fit.** Validation at the boundary or scattered through the logic, a
  new API keeping the old one alive, a change that reads as patched on.
- **Verification.** A bug fix with no test, a test on implementation rather than
  behavior, a check reading a proxy such as a mtime instead of the real value.
- **Complexity budget.** An abstraction with one caller, a branch for a case that
  does not exist, scaffolding kept alive after the migration finished.
- **Security.** Trace the input to the sink and show the path. No path, no finding.
- **Code quality, on top.** The move that deletes a branch, a layer or a helper
  beats the one that rearranges it.

Tell them to trace with `ripwire`, not to assert: showing the call chain that makes
a value nil is the finding, saying it might be nil is not.

Findings come back with severity (`critical`, `warning`, `nit`), the location, the
finding, the evidence, and a suggestion only where there is one. Zero findings is a
valid answer, so say so in the brief and nobody pads the review to look thorough.

## Phase E: Fan out

Spawn every reviewer in one message with `background: true`. If one produces
nothing, carry on and name the dropout rather than running a smaller review than
the one you announced.

## Phase F: Sort the returns

Two or more reviewers raising something independently is the highest signal in the
set. A lone finding still gets read, on less weight. Two reviewers describing one
thing in different words is one finding: merge it and keep both names. A reviewer
flagging something while another says the opposite marks the edge of the change
and tells you where to look yourself.

## Phase G: Lead the judgment

You are the reviewer who decides, not a counter. They saw the artifact and a
paragraph of intent. You have the conversation, the constraints, and what was
already tried and rejected.

Four buckets. **Act on**: real problems against the actual goals, the ones that
would block a merge. **Consider**: legitimate, but the cost of fixing now may
exceed the problem. **Noted**: valid, not actionable, low impact at this stage.
**Dismissed**: wrong, missing context, or a preference dressed as a defect. Each
finding carries which reviewers raised it and one line on why it landed where.

Filter on four things. Nitpick gravity: a reviewer who found nothing real inflates
nits, so a review that is all nits usually means the code is fine. Hypothetical
against actual: "what if this is null" is a finding only if a caller can pass
null, so trace it. Premature abstraction: an extraction nobody asked for is not a
defect unless the code has to change in a second direction anyway. The preference
finding, the commonest false positive, which needs a concrete problem to survive.

Keep the last two buckets. Dismissed is what lets a reader overrule you, and a
verdict with nothing in it reads as a verdict nobody checked.

This produces a verdict. Do not edit code on the back of it.

## Outputs

A verdict: the intent paragraph, who reviewed and what each one found, then act on,
consider, noted, dismissed, and the agreement map. Nothing applied.
