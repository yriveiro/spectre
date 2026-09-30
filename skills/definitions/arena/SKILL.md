# Arena

Put the same task to several models at once. Read every answer end to end. Take
the strongest as the base, fold in the best of the others, and check the result.

## Start

Open a `todolist` with one entry per phase before launching anything.

1. Frame
2. Fan out
3. Cross-judge
4. Pick
5. Graft
6. Verify

## Phase A: Frame

The candidates get the same prompt, so the prompt is the contract.

1. Say what each candidate is producing.
2. Write the rubric. State what success means for *this* task, then turn it into
   three to six criteria you could actually grade. The rubric is the picker's
   tool, not the candidates': they see the task and nothing about the rubric.
3. Pick the seats. Call `tools.spectre.routing({})` and take one model per
   candidate from the profiles. An arena of three wants three different families,
   because two candidates on one model share its blind spots and their agreement
   proves very little. That constraint is the feature, so if the profiles only
   offer one family, say so before spending the run.
4. Give each candidate its own output path under the shared root:
   `~/.local/share/spectre/<worktree-name>/arenas/<slug>/seat-<n>/`, and
   `mkdir -p` it before the fan-out. The shared root is the location that clears
   both tests — outside the project tree, and outliving the session — so a path
   that fails either one is wrong whatever it looks like. The two that come to
   hand are `tools.spectre.worktrees`, which opens a worktree and moves this
   session into it, and `/tmp`, which promises nothing about surviving.

   Candidates writing to one path serialize on it and the fan-out is a lie. The
   root being outside the project directory is what makes the first write ask for
   permission; every spectre agent already allows `external_directory`, `read`
   and `edit` on it, subagents included, so a candidate never stops on the prompt.

## Phase B: Fan out

Spawn every candidate in one message with `background: true`. Each gets the task,
its own output path, and a request for the artifact plus a short rationale naming
the alternatives it considered and what it rejected.

If a candidate produces nothing, carry on with the rest and name the dropout in
the note. Do not silently run a smaller arena than the one you said you would.

## Phase C: Cross-judge

Once every candidate has finished, pick one model for the judge and prefer a
different family from yours. Spawn one read-only judge on it. It sees the rubric
and the answers by path label, scores each criterion, and recommends a base.

The judge runs alongside your own reading, not alongside the candidates. Do not
start it while candidates are still writing, or it scores half-written answers.

## Phase D: Pick a base

Read every candidate end to end before you pick one.

Score against the rubric criterion by criterion. Not on feel. Then read the
judge's verdict, which is why this phase comes after the cross-judge and not
alongside your own reading. Agreement confirms the pick. Disagreement means the rubric was
ambiguous or one of you is anchored, so read both rationales before deciding and
say which one moved you.

Pick the base a future maintainer could extend without breaking an invariant.
When two feel tied, take the smaller surface.

Record the base and the reason, with the judge's verdict, in the note.

## Phase E: Graft

This phase is a hand edit on a base you already chose, so it starts after the
pick and not before it.

Walk each losing candidate once more and take what is worth having. That is
usually one or two things per candidate, not most of it.

Fold each one in by hand. Do not paste a block and move on: the result has to
hold together under one idea, and a graft that contradicts the base is worse than
the thing you dropped.

Record what came from where, and what you rejected and why.

Convergence is a signal. When the candidates land on the same shape, that is the
answer: note it and ship it, no graft needed. Wild divergence means the brief was
underspecified. Reframe and run it again rather than averaging the differences.

## Phase F: Verify

Hold the result to the same bar as any other output. Run the tests, read the diff,
or execute the thing, depending on what it is.

If checking it surfaces something the arena missed, then either the brief was
wrong and you re-run it, or one candidate caught it and you missed the graft. Say
which. Do not paper over it.

## Outputs

One synthesized artifact, and one short note beside it naming the base, each graft
and the answer it came from, the rejections, any dropout, and the verification
result.
