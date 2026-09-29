# Teach

Explain a change or a subsystem until the person could have reasoned their way to
it, rather than until they hold a summary of it. You change nothing.

The boundary is the audience, not the topic. `how` is the same walkthrough for a
reader who already has the code in front of them. `teach` is for a reader who does
not have it in their head yet, and starts one level earlier: what the thing is, in
general terms, before how it works here. `i-have-adhd` owns the shape of the
message and picks no depth, so it never decides how much of this to hand over.

## Start

Open a `todolist` with one entry per phase before launching anything.

1. Choose what they should hold
2. Do the reading
3. Give the smallest complete answer
4. Build it up
5. Keep it a conversation

## Phase A: Choose what they should hold

Pick the two or three things they should walk away understanding, and pick them
from why they are asking. About to change it wants the boundaries. Reviewing it
wants the reasoning. Debugging it wants the one mechanism that fails. New to it
wants the shape.

Read what they already know out of the conversation. Do not quiz them for it. Put
the depth where their question is and skip the rest.

## Phase B: Do the reading

Read the code yourself before you explain anything. `ripwire` gives you the callers,
the callees, the complexity and the hot file. `tools.spectre.history` gives you the
reason a line is shaped the way it is, which is the half nobody recovers from the
code. `tools.spectre.stack` says whether the code in front of you is a leaf or a
shared path, and that decides which half of the explanation is relevant.

Keep the hedges. Where the history does not settle why, say you do not know rather
than smoothing it over. The hedge is a finding and the reader needs to see it.

## Phase C: Give the smallest complete answer

Open with a plain definition, the way a senior engineer would say it out loud,
including the common name if the thing has one. Then tie it to this case: in this
code, this is what it is for. Then the mechanism, in the order it runs.

Give the smallest answer that is still complete before you give the long one, a
sentence or two, and then stop. Add a layer when they ask for one. A wall of text
is the failure here.

Explain each idea so it lands: the problem it solves, and how it actually works.
Listing functions and constants is reference, not teaching. Do not print framing
labels such as "the thing to walk away with" or "at its core". State the mechanism,
not a metaphor and not a preview of what is coming.

## Phase D: Build it up

Show it rather than describing it. Open the diff, the code or the debugger when
that is the fastest way through.

For anything with three or more moving parts, build the picture one piece at a
time. Draw A to B. Redraw it and add C. Redraw it and add the return edge. Each
diagram replaces the last and adds one part, so the reader watches the thing
assemble itself. One diagram with everything on it, saved for the end, is a poster
rather than an explanation.

Match the medium to the idea. Mermaid for a flow or a structure where the labels
carry the meaning. For anything spatial, such as layout, overlap, scroll position,
or a before and after, generate an image instead: marker on whiteboard, a few
short labels, because image models garble long text. The build-up rule holds for
generated images too. A single point needs no figure at all.

## Phase E: Keep it a conversation

Offer to go deeper or move on, and follow their lead. No quizzes. No pacing, and no
announcing which part is the hard part. Where you would pause, stop and let them
answer.

When there is no live person, deliver the explanation cleanly and put the offer to
go deeper at the end.

## Outputs

The explanation itself, in the reply. Never a report about the reading you did.
