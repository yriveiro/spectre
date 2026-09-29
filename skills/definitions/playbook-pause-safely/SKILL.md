# Playbook pause-safely

Stop at a clean boundary and leave a checkpoint another session can resume from
without asking you anything. Explicit only: on "keep going", "going to bed, keep
going", or "don't stop", you do not pause, because this procedure is a stop.

One substitution, because it decides where the note goes. The pstack original aimed
its resume note at whatever the harness would compact the next session into, and
read back to itself. There is no transcript and no compaction file to write here:
opencode keeps sessions in a SQLite database that nothing in this plugin reads. So
the note goes where a cold start will find it — the `wip:` commit body and a plain
file in the repository. A note kept only in your context dies with you.

## Start

1. Reach a boundary
2. Take no irreversible action
3. Make the work durable
4. Write the resume note
5. Report

## Phase A: Reach a boundary

Stop where the next reader can tell what finished and what did not. Finish the atomic
step you are in, or back it out entirely. Do not leave a function half-edited with a
caller already updated, and do not leave a schema migrated with the code that writes
the new form unwritten. A clean tree with a note beats a broken tree with a note.

Start nothing new. Cancel any subagents still running, or record which ones are,
because a background subagent writing to the tree after you commit is how a `wip:`
snapshot stops matching the working directory. If you are mid-run on a measured loop,
note where in the loop you are and what the last measurement said, so the next
session restarts the loop rather than the work.

## Phase B: Take no irreversible action

Pausing is not shipping. Do not open a pull request, do not push, do not merge, do not
delete a branch or a worktree, and do not rewrite published history. The exception is
a push you already had out before the pause was asked for: leave it where it is and
say where it is.

An irreversible action taken to make a stop feel finished is what turns a paused
session into an unreviewable change. If the work genuinely wants a pull request, that
is a decision to state in the note, not one to take at the boundary.

## Phase C: Make the work durable

Commit whatever is uncommitted, as one commit, on the current branch.

- Prefix the subject with `wip:` so it is never mistaken for finished work, and so a
  later pass can find them with `git log --grep=wip:`.
- Stage only the files you touched. `git add <files>`, never `-A`, because the tree
  may hold a generated file or a scratch artefact that has no business in history.
- If the tree does not build, say so in the body, in one line, and say why. An
  inherited broken tree with a stated reason is recoverable; one you discover by
  running the build is a wasted half hour.
- If a real commit already covers the change and only scratch files remain, do not
  manufacture a `wip:` commit. Say the tree is clean in the note instead.
- Do not amend, rebase, or squash anything to make the pause tidier. The snapshot is
  worth less than the history being intact.

## Phase D: Write the resume note

Write it off-context, in a form that survives the session ending. Two places, and the
second is the one a cold start reads:

1. **The commit body**, so it travels with the code. One paragraph is enough there.
2. **A file beside the tree**: `RESUME.md` at the worktree root, or a path under the
   project's own scratch space if the repository does not want a tracked file.
   Commit it with the `wip:` snapshot, or leave it uncommitted and name the path, so
   either way the next session is told where to look.

If a `decision.tsv` or a show-me-your-work trail already exists, point at it rather
than duplicating it. A second copy of the log drifts from the first within a day.

Seven things, and a note missing the seventh is why resumes fail:

1. **Intent.** What this work is for, in two sentences.
2. **What you were doing.** The step in progress when you stopped.
3. **Progress and what is verified.** Which parts are known to work, and how you
   know. An unverified part marked unverified is worth more than an implied one.
4. **Current state.** Branch, worktree, whether the tree is clean, whether checks
   pass.
5. **Next steps.** Ordered and concrete, the first one unambiguous.
6. **Key files.** Paths only, no diffs.
7. **Gotchas.** The thing that cost you the most time, because it will cost the next
   session the same unless it is written down.

Write paths, not pasted diffs. A diff in a note goes stale the moment work resumes.

## Phase E: Report

Say where you are in the loop, what is on disk versus still in your head — by path —
the commits you made, whether the tree is clean, and the first action on resume. That
last one is the sentence the next session starts with, so it is one action, not a
list to prioritise.

## Outputs

- A `wip:` commit, or a clean tree and a statement that it is clean.
- A resume note in the commit body and at a named path.
- The first action on resume, as one sentence.
- A statement of what was not done, and what was deliberately left alone.
