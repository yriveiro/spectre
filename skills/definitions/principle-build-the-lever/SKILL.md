# Principle: Build The Lever

Hand work does not rerun. Editing by hand across many sites feels fast and drifts
by site five: site seven differs from site two in a way nobody intended, review
cannot separate intent from accident because every site was a separate decision,
and the whole pass is charged a second time the next time a new case, a renamed
API, or a second wave arrives. So for non-trivial work, build the thing that does
the job — a codemod, a script, a generator, or a delegated subagent — run it, and
keep it in the diff. The test is a check on the change rather than a question
about the work: if you cited a file in your report and the diff holds no codemod,
script, generator, or delegate, you did not apply this. The neighbouring ground is
`principle-hygiene` for the touch-up you make while editing anyway, and
`principle-encode-lessons-in-structure` for a lesson that has to outlive this
pass.

## The moves

**Count the sites before you decide whether to build.** One or two edits in a file
you are already rewriting is a hand edit with a tool's overhead. The signal is
repetition across files, or the knowledge that this pass runs again, not a number
you are trying to optimise.

**Write the transformation down before you touch the first site.** A codemod is a
sentence about the codebase. Writing it first is how you learn the sentence is
false, which is much cheaper to learn before the edit than after.

**Name the lever, then pick the form from the work.** Codemod for a mechanical
rewrite at call sites. Generator for anything derived from a schema, a type, or a
table, where the derivation is the point. Script for a pass over the tree that
produces a report or a fix. A delegated subagent for a fan-out whose unit of work
is reading and judging rather than replacing text.

**Keep the lever in the diff.** A script run from memory and deleted afterwards is
hand work with extra steps. The question is whether a stranger could rerun this
pass tomorrow without you. If the answer is no, the artefact is missing and the
next person rebuilds it by hand.

**Build the set into the tool, so review sees intent once.** Forty hand edits are
forty decisions a reviewer cannot separate from accident. A tool plus its output
is one decision and forty repetitions, and that is the whole reviewability gain,
independent of how the tool is written.

**Express the transformation as a pattern over the tree, not as a list of paths.**
A pattern finds cases outside the folder you happened to be looking at, and those
are where the drift lives. A list of paths you assembled by hand is a list that
is already out of date, and it is out of date silently.

**Let the tool refuse the cases it cannot handle, and report them.** A pass that
guesses at a site it does not understand will be wrong there and will look right.
The list of refusals is the most valuable output of the run, because it is the part
a hand pass would have skipped without noticing.

**Run it twice, and require the second run to be a no-op.** A transformation that
still changes something has not covered the set. The second run is also the
cheapest evidence that the tool is deterministic, which is the property the next
wave needs and the one nobody checks.

**Name the pass in `package.json`, a Makefile, or CI, or it will not run again.** A
command nobody can type is a command that gets rebuilt by hand next quarter. The
entry is one line, and it is the difference between a lever and a script you
remember you wrote.

**Keep the judgement local and delegate the fan-out.** A subagent is the right
tool for a hundred-file read and the wrong tool for deciding what correct means.
The population, the criterion, and the shape of the report stay with you, because a
delegated judgement comes back as a summary you cannot check.

**Throw the throwaways away and keep the recurring ones.** A script written for a
single one-off is a liability in the tree, and a script written for the second
wave is the cheapest thing in the diff. The test is whether you expect to run it
again, not whether writing it felt productive.

**Delete the hand edits, including the ones that were right.** Mixing forty manual
edits with a tool's output produces a diff nobody can read in either half. Start
again from a clean tree, and the tool's second run hands you the whole set for
free.

**Let the tool own the residue check.** The end of a batch is a count of what it
changed and a confirmation that nothing is left. Without that, done is an
impression, and the next session inherits the unconverted sites plus the belief
that they were converted.

## What this principle is not

- **Not a tool for every edit.** Two changes in a file you are already rewriting
  is a codemod that costs more to write than to skip, and it leaves an object in
  the tree somebody has to maintain. Build when the work recurs or the sites
  multiply, not because a tool is available.
- **Not a substitute for deciding what the change means.** A tool applies the
  transformation you chose. It does not choose it. The wrong transformation applied
  forty times is forty wrong edits, and machine-made ones read as deliberate in
  review, which is the part that hurts.
- **Not a licence to delegate the decision.** A subagent that reports done without
  the set of paths and a diff has moved the work rather than performed it. Keep the
  population, the criterion, and the report shape where you can check them.
- **Not a generator over something with no source of truth.** A generated file
  checked in beside a hand-maintained one drifts, and the drift is invisible until
  the two disagree. That is `principle-hygiene`'s one decision, one source, reached
  from the codegen side.
