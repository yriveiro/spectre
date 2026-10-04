# Playbook runtime-forensics

Diagnose a live process by instrumenting it. The signal comes off the running
process, not out of a file, and the deliverable is a cause with a file and a line
attached to it. No fix, unless asked for one after the cause is named.

## Start

1. Capture the live signal
2. Reduce the artifact
3. Prove the mechanism
4. Map it to source
5. Hand back the diagnosis

## Phase A: Capture the live signal

Take a profile from the process as it misbehaves, on the surface that matches the
symptom. A worker pegging a core wants a CPU profile. A server whose memory climbs
wants a heap snapshot. A UI that stutters on scroll or hover wants a trace, and the
`playwright` and browser tools in this session can drive the page and record one.

The capture has to be an artefact, not an impression. "It feels like the parser" is a
starting guess. A profile with the parser at 80% of self time is the finding, and
they are separated by exactly this phase.

Capture under the conditions that produce the complaint, because a profile of an
idle process profiles nothing. Save the artefact under the project's scratch space
and keep the path. The next two phases read it more than once.

## Phase B: Reduce the artifact

Large profiles and heap snapshots are far bigger than anything useful to read whole.
Reduce before you interpret: the top frames by self time, the retainer chain from
the leaked object, the interaction that fires the long task.

Do the reduction in a subagent so the raw artefact does not land in this context.
Call `tools.spectre.routing({})` and take the model from the profiles rather than
from memory. What comes back has to be one claim with a number on it. "Something in
the request path" is not a reduction. "resolveRoutes is 74% of self time across 41
samples inside a 3.2s window" is, and it is falsifiable against the artefact.

## Phase C: Prove the mechanism

You believe the reduced finding because the profile says so. The profile says
something *correlates*. A mechanism says *because*. Confirm it cheaply, on the live
process, before writing it down as a cause.

That usually means an intervention and an observation: evaluate an expression in the
running process to read a value the profile only implied, patch a counter into the
suspect path and watch the number it counts, disable the suspect call and see the
symptom go. The `playwright` and browser tools reach into a running page for
evaluation. On a server, a temporary log line or a counter in the hot path does the
same work.

If the mechanism will not confirm, say it did not. A hypothesis that survived
Phase B and failed Phase C is a valuable outcome, and recording it as a cause is the
one thing this playbook must never do.

Every count from here is a sample from one process on one machine at one moment, so
it needs to reproduce across a second run before the finding is reported as settled.

## Phase D: Map it to source

Take the reduced finding to the code: the file, the symbol, the line that allocates
the memory or schedules the work. A frame or a stack that stops at a name is not
yet a diagnosis, and the mapping is usually one hop.

`ripwire` is the instrument for the hop. `ripwire --callers` and `ripwire --callees`
on the suspect symbol give the neighbourhood, and a symbol with one caller that only
forwards is a shape you should name in the report, not fix here.

`tools.spectre.history` on the touched file is worth one call when the code looks
deliberate, because a guard that looks wrong is often a reason somebody recorded.

## Phase E: Hand back the diagnosis

One citation: the signal, the reduced finding, how you proved the mechanism, the
source location, the artefact paths. Then stop. The fix is a different piece of work,
and it belongs to a bug fix or to `playbook-hillclimb`.

Mark what the evidence supports, because three different findings share one shape
here: confirmed by intervention on the live process, observed in the profile with a
mechanism that fits, or suspected and unconfirmed.

## Outputs

- The signal and the surface it came off.
- The reduced finding, with its numbers.
- How the mechanism was proved, or the sentence saying it was not.
- The source location, file and line.
- The artefact paths.
- No fix, unless asked. Then route to a bug fix or to `playbook-hillclimb`.
