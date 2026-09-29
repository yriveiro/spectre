# Playbook hillclimb

Improve one measurable thing against a target, over many iterations, keeping only
the attempts the measurement says are wins. The metric, the direction that counts
as better, and the stop condition are fixed before the first attempt, and every
claim of improvement is a pair of numbers from one frozen harness. You supervise
and review; the attempts themselves are delegated.

## Start

1. Fix the metric
2. Freeze the harness
3. Open the log
4. Attempt
5. Push past the plateau
6. Stop and report

## Phase A: Fix the metric

Ground the workload before choosing the metric. Read the target with `how`, name
the dimensions that can move the result — data size, history depth, state count,
concurrency — and pick a case that reproduces the complaint. If no case reproduces
it, fix the repro first.

Then write down three things and keep them visible for the whole run:

- **The metric**, and the direction that counts as better. Latency down, throughput
  up, memory peak down. Not "faster", which is a word and not a number.
- **The target**, with a checkable predicate. A target alone ends the run on a lucky
  early win, so pair it with a floor on attempts: at least 50% better than baseline
  *and* at least 10 iterations is this shape.

Every number in the run compares against the baseline recorded in Phase B. A metric
with no baseline has no delta, and a delta is the only thing this playbook produces.

## Phase B: Freeze the harness

Build the measurement, then prove it is sensitive enough to see the thing you are
chasing. Run two contrasting workloads: the target case, and an easier one that
should not move. If the harness reports the same number for both, it cannot see the
effect, and revising the workload or the metric comes before any optimization.

Then freeze it. One repeatable command, sampled enough to clear the noise — a median
over N runs, not one run, because a single sample of a noisy system is a coin flip
with extra steps. Write the command down and do not touch it again; a harness edited
mid-run makes every number in the log incomparable with the numbers before it.

Before the first change, record two things: the **baseline metric**, and a **green
regression gate** — the tests that must keep passing. The gate is what stops a
faster wrong thing from winning.

## Phase C: Open the log

One row per attempt, in a `decision.tsv` outside the tree so it never ships:
id, hypothesis, change, before, after, delta, gate, verdict, note. Verdict is
`kept` or `reverted`, and a reverted attempt gets a row exactly like a kept one.

Read the log before each attempt, not after. The point is not the record, it is that
a fifth attempt is often a second attempt at the first, and the log is how you notice
before spending the work.

`principle-evidence` owns the general form; here the oracle is the frozen harness,
so a contested change is settled by a number and not by reading the diff.

## Phase D: Attempt

Loop, one hypothesis per iteration, grounded in the Phase A model, so it names a
mechanism — "defer the migration off the boot path because it blocks first paint" —
rather than "try memoizing something".

1. Hand the change to a subagent with a tight scope and a named model from
   `tools.spectre.routing({})`. Never a model id from memory. When several
   independent hypotheses are live, fan them to parallel subagents so the shared
   tree is not a serialization point. Each one needs its own checkout, and
   `tools.spectre.worktrees` is one worktree per session: this session cannot open
   them, because the first call moves it in. So a fanning-out parent stays on
   main, and each subagent opens its own worktree as its first act — or works in
   the main checkout read-only and writes nothing, when the hypothesis is small
   enough that a scratch path beats a branch.
2. Measure before and after with the frozen harness, and run the gate.
3. Keep only when the delta clears the noise *and* the gate is green. Otherwise
   revert the change in full. A tweak that "might help" is not kept.
4. One commit per kept fix, staging only the files you touched — `git add <files>`,
   never `-A`.
5. Log the row either way.

Each iteration ends in a check before the next one starts, so an unattended run has
somewhere to be resumed from.

## Phase E: Push past the plateau

The first plateau is where runs die. On a stall, do one of these rather than
concluding the hill is climbed: pivot the category of change, combine two near
misses, re-read the source with the harness's numbers in hand, or attempt something
radical and revert it if it fails.

Correctness and simplicity outrank the number. Revert a win that breaks behaviour.
Keep a simplification that holds the number, and log it as a win, because it is one.

## Phase F: Stop and report

Stop when the predicate is met, or when the remaining ideas are marginal enough that
their cost is not worth it. Do not relax the predicate to reach it, and do not quit
while a cheap untried hypothesis is still on the list. If you are stuck, say so
rather than looping.

## Outputs

- The metric, the direction, and the target.
- Baseline to final, with the percent delta and the sample count behind it.
- Iterations run, split kept against reverted.
- One line per kept fix.
- The `decision.tsv` path.
- The best idea you would try next, and why it is not already done.
