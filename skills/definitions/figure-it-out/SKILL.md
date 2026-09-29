# Figure it out

No bundled procedure fits, so design one for this task. The deliverable before
any code is the workflow itself: phases that scale their own rigor to the
stakes, units run as hypotheses against a written predicate, and a trail a
person can audit after they have stepped away.

`spectre-mode` routes to a leaf, and when nothing fits it says so by writing
`none` with reasons. This is the answer to that line. It is not
`principle-exhaust-the-design-space`, which settles one decision by building
alternatives; this is what you write when there is no decision left to settle
and the whole sequence is yours to define.

## Start

Open a `todolist` whose first entry is to read the principles index in
`spectre-mode/SKILL.md`. Add the phases below as todos after it.

1. Frame
2. Design the workflow
3. Run the loop
4. Keep the trail
5. Verify

## Phase A: Frame

Ground first, then commit to the run. Do not start until you can state all
three:

1. **Done**, as a predicate that can come out false. A test result, a number, a
   query returning rows. `principle-prove-it-works` owns the shape of the
   predicate.
2. **Scope**, quantified: rough unit count, rough effort, and the blockers
   grounding surfaced.
3. **Rigor**, biased high. A one-way door with a wide blast radius gets gates
   and artifacts. A reversible low-stakes step gets the shortest check that
   catches the obvious. Rigor is gates and artifacts, not more effort.

Show the framing before a long run begins. Reversible work proceeds without
asking (`principle-never-block-on-the-human`); a run measured in hours earns one
checkpoint.

## Phase B: Design the workflow

Break the scope into units small enough to land on their own, and sequence them
riskiest-unknown first. Scaffolding and verification come before features.

- Build the check before the work, and capture the baseline from the
  pre-change state, so every later result reads as old value against new.
- For a one-way-door design decision, run `architect`, which runs `arena` on the
  sketch. Skip it for mechanical work whose shape is already concrete, and skip
  it when a settled design is being changed rather than chosen: a second arena
  over a decision already made is `principle-laziness-protocol` charging you
  for the look of rigour.
- Decide what fans out. Parallelize across seams only, and give each worker its
  own worktree or its own path under
  `~/.local/share/spectre/<worktree-name>/`, because workers sharing one path
  serialize on it (`principle-separate-before-serializing-shared-state`). Take
  the models from `tools.spectre.routing({})`, one family per worker, and never
  write a model id from memory.
- Write the designed phase list down. That list is the artifact the reviewer
  reads.

Then execute it. Add the steps as concrete `todolist` entries after the Phase C
entry, and run each under the loop discipline in Phase C.

## Phase C: Run the loop

Every unit is an experiment: state the hypothesis, make the smallest change that
would test it, measure against the predicate on the real artifact, keep it if it
advanced and revert it if it did not. Verify a unit before starting the next
one rather than batching checks at the end
(`principle-sequence-verifiable-units`).

- Verify by inspecting the artifact, never by accepting a self-report. When
  something passes suspiciously easily, suspect the measurement before the
  system.
- Pair delegated work with a judge. A worker that games the gate gets a reset
  and a harder contract. A gate that is itself wrong gets fixed in its own
  change rather than routed around.
- Every verdict is VERIFIED, NOT VERIFIED or INCONCLUSIVE. Inconclusive is not
  a pass, and a negative result goes in the write-up unsoftened.

## Phase D: Keep the trail

The trail is git, because that is the only durable record this setup has. Land
each unit as its own commit and write the body: the hypothesis, what you
measured, the verdict, and what you rejected. A subject line says what changed
and a body says why, and `why` is the part a reviewer cannot recover from the
diff.

Make the trail auditable by a person, not just by you. `tools.spectre.history`
on the touched files is the read-back: a commit body that says "keep" or "for
now" is the reasoning a later reader needs, and a file with `reverts` above
zero has been argued about already.

## Phase E: Verify and hand back

Check the whole run against the Phase A predicate on the real product, not only
against the harness you built for it. Then turn any correction you made twice
into something mechanical: a gate, a lint rule, a check, or a script
(`principle-encode-lessons-in-structure`).

Answer, in this order: the workflow you designed, the rigor level and why it
sits there, where the trail is, what is verified against the predicate, and what
is still open. INCONCLUSIVE items are listed as themselves.

## Outputs

One written workflow, the phase list, in the repository before the code that
follows it. One commit per landed unit, each with a body carrying the
hypothesis and the verdict. One closing message with the five answers above, and
every gate added in Phase E named.
