# Playbook trace-forensics

Read a capture that already exists, shape it into something queryable, narrow to the
cause, and attribute it to source. The artefact is a fixed dataset: you do not
re-run the workload, and you do not change the file. Every number you report has to
come back out of that same file on a second read.

`playbook-runtime-forensics` instruments a process that is still alive. Here you
have the tape, and the tape does not change.

## Start

1. Identify the format
2. Make it queryable
3. Narrow to the cause
4. Attribute to source
5. Confirm or mark unconfirmed

## Phase A: Identify the format

Know what you are holding before you parse it. A `.cpuprofile` is JSON with a node
tree and time deltas. A `.json.gz` trace is a Chrome trace event stream. A
heapsnapshot is a graph of nodes and edges. A spindump is text with thread stacks,
and a text artefact wants a text tool, not a JSON parser.

Loading the wrong tool is the failure this phase prevents, and it is a silent one:
most parsers will hand back an empty result for a file they do not understand, and an
empty result reads exactly like a clean process. Keep the tooling generic: a
DevTools or trace parser for profiles and traces, a text editor for stack dumps, your
heap tooling for snapshots.

Large artefacts do not belong in this context. Reduce them in a subagent — call
`tools.spectre.routing({})` and take the model from the profiles — and keep the
reduced finding here. The subagent gets the path and the question, and returns rows
and a claim, not the file.

## Phase B: Make it queryable

Do not read the raw artefact. Transform it into a shape you can ask questions of:
one row per sample, per stack frame, per heap node, per trace event. For a profile
that is a flat table of self time per frame. For a heap snapshot, nodes and retainer
edges. For a spindump, one row per thread per sample.

The point is that you get to *query*. "Which frames hold the most time" stops being
inspection of a wall of JSON and starts being a sort. Where the rows are numerous
enough to matter, `bun:sqlite` is the store — it is built into the runtime, and it
turns the narrowing into a query rather than a second pass over the file.

Reach the queryable shape before you read anything. Reading the artefact in its raw
form is how a 40MB profile becomes an hour of scrolling and a conclusion nobody can
reproduce.

## Phase C: Narrow to the cause

Now query the shape you built. The query differs by symptom:

- **Slowness.** Sort by self time, take the top frames, walk the call tree down to
  the hot path. The frame with the most self time is the one to attribute. The tree
  says what called it.
- **Leak.** Start from the object whose retained size is anomalous and follow its
  retainer chain up to a GC root. The retaining path is the finding, and every link
  in it is a place somebody can release the reference.
- **Hang or stall.** Find the thread stuck on-CPU or blocked, and read its wait
  reason. A thread waiting on a lock names the thread holding it.
- **Flakiness.** The interesting artefact is a set of profiles. Find what is present
  in the slow ones and absent in the fast ones.

One symptom, one narrowing. A finding that answers a different question is a real
number attached to the wrong claim.

## Phase D: Attribute to source

Map the hot frame or the retaining object to a file, a symbol, and a line, using the
symbols the artefact carries. Most profiles embed a `url` and a line number per node.

A frame with no source mapping is not yet a diagnosis. Either resolve the symbols —
no map was collected, the build was minified, the file has moved since — or say
plainly that the artefact does not carry them. Do not guess a file from a function
name. That is an inference wearing a citation.

`ripwire` confirms the symbol on the source side once you have a name, and
`tools.spectre.history` tells you whether the line was deliberate when the code looks
wrong.

## Phase E: Confirm or mark unconfirmed

A paired capture settles it: a before and an after the same change, read through the
same queries. A frame that was 74% and is now 3% is a confirmed cause, and the delta
is the proof — `principle-evidence` in one operation, with the second capture as the
oracle. Without one, the honest label is that this is the strongest hypothesis the
artefact supports. A single capture says where the time went. It cannot say that
changing that would move the symptom.

## Outputs

- The artefact and its format, with the tool that parsed it.
- The queryable shape you built, and where it lives if you persisted it.
- The reduced finding, with the numbers it rests on.
- The source location, file and line, or the statement that the artefact carries no
  symbols.
- Whether a paired capture confirmed it, or the mark that says it did not.
- No fix, unless asked. Then route to a bug fix or to `playbook-hillclimb`.
