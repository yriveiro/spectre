# Swarm

Put work out to several workers at once. They cover separate slices, race the same
brief, or mix both. You wait, read what came back, and return one report.

A swarm reports on work that was going to happen anyway. It does not invent the
shape of the thing. When the hard part is deciding what to build rather than
getting it done, that is `arena`, and this is the wrong tool.

## Start

Open a `todolist` with one entry per phase before launching anything.

1. Frame
2. Fan out
3. Aggregate
4. Report

## Phase A: Frame

1. Say what "done" is, and whether the output is an artifact or a report.
2. Choose the shape. Partition into slices, race N workers on identical briefs, or
   mix both. For a race or a mixed shape, declare the selection rule up front:
   first pass, rank all, or best-of. Deciding afterwards is how a race turns into
   an argument.
3. Set N. The user may have said. Otherwise derive it from the shape: one worker
   per slice, and enough arms on a race to make the comparison mean something.
   N is total workers, not a concurrency limit.
4. Pick the models. Call `tools.spectre.routing({})` and take them from the
   profiles. Coverage wants a cheap model per slice, since the work is
   mechanical. A race wants different families per arm, because two arms on one
   model share its blind spots and the race proves nothing. Name each arm's model
   before you spawn.
5. Give each worker its own writable path when it writes:
   `~/.local/share/spectre/<worktree-name>/swarm-<slug>/worker-<n>/`. Workers
   sharing one path serialize on it and the fan-out is a lie.

When workers check or measure commits, each brief names the exact SHAs, and a
measurement brief also names the method: how many samples, what one sample is,
what order. The worker records both in its result.

## Phase B: Fan out

Spawn all N workers in one message with `background: true`, each with its model
and its own brief. Every brief stands alone, because a worker cannot ask you a
question. Each one carries the goal, its scope, its exact slice or race arm, how
to verify, and what to report back.

Reports come back as `PASS`, `ISSUES` or `BLOCKED`, with the evidence attached. A
worker that can prove a defect reports `ISSUES` and lists every issue it proved,
not only the first one it found.

If a worker drops out, carry on with N-1 and name it. Do not quietly report a
smaller swarm than the one you said you would run.

## Phase C: Aggregate

Read the terminal results.

A result that does not record the SHAs and method its brief named is not a
result. Drop it and rerun that worker once. If it misses again, record a gap, and
a gap is not a pass.

For coverage, every slice you promised needs a result. Missing one means the
coverage claim is wrong, not that the slice was fine.

For a race, apply the rule you declared in Phase A. Do not re-rank because you
like a different answer.

Keep a compact table, one line per evidenced issue, and the gaps and dropouts
named. Do not paste raw worker output at the reader.

## Phase D: Report

One consolidated report in the conversation: the table, the issue one-liners, the
gaps and dropouts, and the selection rule when you ran a race.

Say what the swarm did not cover. A report that hides its gaps is worse than no
report, because the reader stops checking.
