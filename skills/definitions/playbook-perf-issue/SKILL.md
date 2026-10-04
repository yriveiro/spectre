# Playbook Perf Issue

Own a measured slowdown from a baseline number to a second number. Every fix
traces to a measurement, and a fix that cannot be tied to one is a guess with a
diff attached.

`ripwire` is the instrument. This owns when to reach for it, which hypothesis the
signal points at, and how to read the delta — including the one thing it cannot
answer, which is the thing that gets confused most often: its counters are static
graph measures over the index, so a high complexity on a function is a
maintenance cost and not proof that the function is hot. Complexity is not a
temperature reading.

## Start

Open a `todolist` with one entry per phase before reading source.

1. Baseline
2. Hypothesis
3. Fix
4. Re-measure
5. Ship

## Phase A: Baseline

State the symptom as a number on a named surface, before reading any source.
"Feels slow" is a complaint. "The list takes 900ms past fifty items" is a
baseline you can improve and prove.

This setup has no APM, no error service and no metrics service, so nothing
replaces a captured profile for you. What does replace it, depending on the
surface:

- **A browser surface.** `tools.playwright.browser_network_requests` gives the
  numbered waterfall, and `tools.playwright.browser_evaluate` with
  `performance.now()` gives a timing harness you can run repeatedly.
- **A runtime surface.** Write the harness, run it enough times to see the
  spread, and save the artifact outside the tree so the post-fix run compares
  against the same conditions.

Record the machine state that mattered: cold or warm cache, first run or
hundredth, the data size. A baseline that is only true on a warm hundredth run
does not describe what your user is looking at.

Do not claim a ceiling without running it. "This cannot be faster than the
network round trip" is a claim you earn with a number or drop.

`tools.spectre.history` on the slow path tells you whether you are looking at
something that has been slow since it landed, which decides whether you are
optimizing or correcting.

## Phase B: Hypothesis

Ground the hypothesis with `how` over the affected subsystem so you know what
the work is for, then pick from eight families. They are hypothesis generators,
not a checklist. A family earns an attempt only when the measurement shows the
signal it names.

- **Elimination.** Does the hot path need to exist? A computation nobody consumes,
  a gate always off for this user, a sync mirroring state someone already holds.
  The trace shows what is slow, never that it is deletable, so this family
  needs the `how` pass rather than the profiler.
- **Divide and conquer.** The cost scales with input size. Chunk, shard, or
  prune the search space so each piece touches less.
- **Caching.** The same computation or fetch repeats on identical inputs. Name
  what invalidates it before you claim the win.
- **Indirection.** Expensive work on the hot path that a cheaper intermediate
  could absorb: an index for a scan, a queue that moves work off the interactive
  thread. Add the hop only when it removes more than it adds.
- **Batching.** Many small operations each paying a fixed overhead. Coalesce
  them and pay it once.
- **Redundancy.** The wait hangs on one slow instance. Duplicate the work and
  take the fastest, and only when the trace shows the wait dominating and the
  system has headroom.
- **Lazy evaluation.** Cost landing on results nobody uses. Defer to first use.
- **Scheduling.** Work that must happen but not now. The win is perceived
  latency, so measure the interactive path rather than total work done.

Then write down which family the signal points at, and why. A fix with no named
family is a change you are hoping works.

## Phase C: Fix

Plan from the measurement, not from the reading. If the fix crosses a function
boundary, run `architect` first.

Delegate the implementation to a `subagent` with the measurement in the prompt —
the numbers, the surface, the family — and choose the model with
`tools.spectre.routing({})`, never a hand-written id. Read the diff yourself.
Verify each attempt before trying the next, so you never end up with three
changes and no idea which one moved the number.

## Phase D: Re-measure

Same harness, same surface, same machine state. Parse and diff the two
artifacts. "Inconclusive", or a number from a different surface, is not a pass.
Flag it.

If the number did not move, revert. An unproven change is not a cheap change,
because it is now in the file and the next person has to reason about it.

## Phase E: Ship

Cite the measurement in the pull request: baseline, post-fix, delta, and where
the artifacts are. Open it with `gh pr create`. A perf change without the number
in the description is a perf change nobody can check.

Sustained improvement against a metric is not this playbook. Write the loop yourself, or route the whole campaign
to `figure-it-out`.

## Outputs

The baseline number, the post-fix number, the delta, the artifact paths, and the
family each fix came from.
