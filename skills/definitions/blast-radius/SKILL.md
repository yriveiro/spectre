# Blast radius

Work out what a change breaks somewhere else before it lands, and prove the one
fact its safety depends on instead of asserting it.

Listing the callers is not this job. `ripwire.impact` on each changed symbol is
one deterministic call, so run it and use what comes back. The job is the
breakage that will not show up there: the JSON an API returns, a database column,
a wire format, another language reading the same bytes, a feature flag, code
three hops downstream. `ripwire.edit_check` answers the narrow question, whether
your own edit touched a contract, and this is the wide one. The companion calls
are `how`, for what the code currently does, and `principle-evidence`, for the
discipline of the proof itself.

## Start

Open a `todolist` with one entry per phase before launching anything.

1. Read
2. Find the fact
3. Look past the index
4. Rank
5. Prove
6. Hand back

## Phase A: Read the change

1. Read the diff, then read what the diff does not spell out. A three-line change
   to a shared helper is not a three-line change to the system, and the gap
   between those two sentences is the whole exercise.
2. Run `ripwire.impact` on every symbol the diff adds, changes or deletes, and
   `ripwire.edit_check` on each one. Write the results down. Zero callers means
   the index found none, which is a different sentence from "nothing calls it":
   a floor, not a total, and `--skipped` names what the index dropped.
3. `tools.spectre.history` on the files in the diff is worth one call. A line
   that exists for a reason nobody wrote down gets deleted by somebody who never
   learned it, and the commit body is the only place that reason survives.
   `reverts` above zero means the file has been argued about, and the losing
   argument is often still in the tree.

## Phase B: Find the fact

Almost every change that looks risky is safe because of a single fact: this call
only drops already-dead entries and does nothing else. These two callers are
already inside the guard. This field is only read behind the feature flag.

Spend the session here rather than on a long list of maybes. If the fact holds,
most of the risk list clears at once. If you cannot find one, say that: it is
the most useful sentence in the report, because it says the change is unverified
rather than mildly scary.

## Phase C: Look past the index

This is the phase a grep cannot do. Read the source of the library you call, and
check the version you pinned against the version you are reading. Work out when
the code runs: microtasks, teardown, unmount, the difference between a framework
that batches and one that does not. Then follow what a symbol search misses:

- the shape an API returns, not the function that fetches it
- a column, a key, a table, a queue message
- a serialized format that two languages read
- a feature flag and its default
- the config file a value is copied into
- a test that pins the old behavior and will now fail for a reason nobody reads

## Phase D: Rank

Keep the risks that have a real chance of happening and a real cost if they do.
Everything else goes on a cleared list, and that list is not padding: it tells
the reader where you looked, which is what stops the next person repeating the
hour.

Each risk names how it breaks, the `file:line`, how likely it is, how bad it is
if true, and the cheapest check that would settle it. A search that finds nothing
is a result and belongs on the cleared list with the query written down. Never
invent a caller and never invent an API signature. A fabricated `file:line` is
worse than an honest gap.

## Phase E: Prove

For the fact from Phase B, get it as far down this list as is cheap, and record
where it stopped:

1. You said so. Worthless on its own, and it still belongs in the report as
   unproven.
2. You pointed at the line. A real `file:line`, or the library's own source.
3. You walked the bad case and it does not reach. Every step accounted for.
4. You ran it. A script or a test that calls the real code and fails loud if
   you are wrong. Usually one small script that imports the same module the app
   ships and calls the exact function you are worried about.
5. You reproduced it in the running app.

Step 4 is where the real time goes and it is the only step that makes the rest
of the report worth reading. A writeup that sounds right is worthless: it reads
as convincing whether or not it is true, so a reader with no way to tell the
difference has to re-check all of it.

If the change is wide enough that one reading of it is one opinion, stop and run
it as an `arena` — the same question to several models, then merge what they
found. Different models find different real breakage, which is the point of
asking more than one.

## Outputs

- **What it changed**, including the part the diff does not show.
- **The one fact it is safe because of**, with the step it reached and the
  output of what you ran. `unproven` is a valid answer. A confident sentence with
  nothing under it is not.
- **Risks**, each with how it breaks, the `file:line`, likelihood, cost and the
  check that settles it.
- **Cleared**, what you checked and why it is fine.
- **Before you merge**, the cheapest test or repro that catches the real bug,
  including the script you wrote.
