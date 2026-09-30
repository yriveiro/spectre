# Playbook eval

Compare two candidate skills without either of them knowing it is being compared,
and find out which one to keep.

**This is not the `eval/` harness in this repository.** That one measures
whether this set's descriptions route a held-out set of prompts to the right
leaf, across the whole catalogue. This playbook is one experiment on one
candidate, blinded end to end, run because reading a rewritten description is
not evidence about what a model will do with it.

## Start

1. Frame
2. Build the environments
3. Author the prompt
4. Run the candidates
5. Run the judge
6. Read the chain
7. Synthesize

## Phase A: Frame

State which variant is under test and what behaviour would count as success. A
description rewrite is usually under test because a prompt stopped routing; name
the prompt shape you expect to be fixed, because a generic answer means you
cannot tell afterwards whether it worked.

Write the rubric: three to six criteria you could actually grade, each one
concrete enough that two judges would give the same number. Keep it for the
judge. The candidates never see it, and neither does the person reading your
note until the end.

## Phase B: Build the environments

One working directory per candidate, with the variant in place. Plant the
context an organic task would really have: a project skeleton, the files the
candidate would naturally read, a build that works.

Sanitize the directory and file names. Use project-shaped names a user might
pick, because a directory called `candidate-2` or `eval-skill-test` tells the
model it is under test before you have said a word.

## Phase C: Author the prompt

Write one prompt, the way a user would type it. State the goal, not the
mechanism, and do not say what is being measured.

**The blinding rules, and they are not adjustable:**

- None of `eval`, `test`, `judge`, `experiment`, `rubric`, `score`, `compare`,
  `benchmark`, `candidate` or `arena` may appear in any directory, file, or
  prompt the candidate can see.
- No chain-eliciting cues. Do not ask which skills, principles or files the
  candidate applied. Ask for the work and, if you want commentary, for design
  notes generally. Chain-following is graded from the code's shape, not from a
  self-report.
- Never say that other candidates exist.

## Phase D: Run the candidates

Spawn the candidates in parallel, one per variant, on models chosen with
`tools.spectre.routing({})` and preferably from different families, since two
candidates on one model share its blind spots and their agreement proves very
little. Each gets the same prompt, its own sanitized directory, and its own
output path under
`~/.local/share/spectre/<worktree-name>/evals/<slug>/seat-<n>/`.

Say the same thing to each. Anything one candidate is told that the other is
not is a difference in the experiment, not a difference in the result.

## Phase E: Run the judge

One judge, on a different model family from the candidates, and blind in the same
way: the rubric and the outputs by sanitized label, never a model name and never
a variant name. The judge knows it is judging.

When you are comparing two variants rather than grading a single run, use one
judge on one scale over both sets in a single pass, blind to which set came from
where. Two judges on two scales produce two numbers you cannot subtract.

`arena` has the fan-out and cross-judging phases written out; this is the same
shape with the labels scrubbed.

## Phase F: Read the chain

**Grade the chain from artifacts, not from self-report.** A candidate that says
it followed the skill's method has told you what it wanted credit for. What it
produced is evidence: which files moved, which shape they ended up in, whether
the artefacts the skill names are there.

There is no transcript store here, so the read set is the soft part of this
phase. Ask each candidate to list the paths it read in its report, treat that
list as a claim, and spot-check the two or three files it says the work turned
on. A candidate that read nothing and produced the right shape is a different
result from one that read the right thing and produced the right shape, and only
one of them is the result you are looking for.

## Phase G: Synthesize

Read every candidate's output end to end yourself before you read the verdict.
Compare it to the judge's. Disagreement means either a model is biased toward a
particular style, or the rubric was ambiguous, and those call for different
fixes: rewrite the rubric, or change which model you judge on.

Then recommend, with the reason. "Promote B" and "A and B tie, and the tie is
the interesting result" are both answers.

## Outputs

The variant under test, the rubric, per-candidate notes, the judge's verdict,
your own reading, and a recommendation for whether to promote the variant.
