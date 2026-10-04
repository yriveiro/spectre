# How

Explain a subsystem so that a senior engineer who has never opened it can work
in it. Not annotated source, not a summary of the diff. The reader has a
question about this subsystem afterwards, and your explanation is what they will
answer it from.

`principle-evidence` owns getting the proof. This owns the writing. `ripwire.explore`
is the orientation call: a ranked map of the subsystem, and a map is not an
explanation. `blast-radius` is the other neighbour — it asks what a change would
break, where this asks what the thing currently does.

## Start

Open a `todolist` with one entry per phase before launching anything.

1. Frame
2. Orient
3. Trace
4. Write
5. Hand over

## Phase A: Frame

1. Write the question in one sentence, in the reader's words rather than the
   code's. "How does a tool get registered" is answerable. "Understand the
   architecture" is not, so when the request is the second kind, pick the
   concrete question underneath it and say which you picked.
2. Say who the reader is. An engineer new to the subsystem needs the flow, the
   abstractions and the gotchas. Somebody already working nearby needs only the
   part they cannot see from where they stand. Name the assumption out loud.
3. Set the depth. Walk until the picture holds together without hand-waving,
   which is not the same as reading every file. One module or one narrow question
   is a single pass you do yourself. A subsystem spanning several files or
   services needs more than one reader.

## Phase B: Orient

Call `ripwire.explore` with the question and read the ranked result before you
open anything. It names the entry point, the symbols that carry the subsystem and
the neighbourhood.

When the answer comes back thin, run `--skipped` before you believe it. A
subsystem that looks like three files is usually one large unparsed or generated
file, and the index is a snapshot rather than a total.

Then read the entry point yourself. The map says where to look. Only the code
says what it does.

## Phase C: Trace

For a single module or a narrow question, trace it yourself and go to Phase D.

For a subsystem spanning several files or services, split it into two to four
angles, each a distinct slice, and spawn one read-only explorer per angle in a
single message with `background: true`. Each gets the question, its one angle,
and the report shape below. The angle is narrow on purpose: an explorer that
covers the whole subsystem returns a shallower version of the same answer four
times.

Pick the models with `tools.spectre.routing({})` and pass the strings exactly as
they came back. Read-only tracing is mechanical, so a cheap profile is usually
right for the explorers. The writing in Phase D is judgement and goes on a
stronger one. Never write a model id from memory, and do not put several
explorers on one model and call the agreement a cross-check, because they share
whatever that model cannot see.

Each explorer reports, in this order:

1. The components it found, each by name, file and one sentence.
2. The flow as an ordered list of what runs, in which file, what it does and what
   it calls next, with the data moving between steps.
3. Every file it read.
4. Where the subsystem's boundary is and what crosses it.
5. Anything surprising, historically motivated or easy to get wrong.
6. What it could not trace.

An edge the explorer could not follow, written down as an open question, beats a
confident guess, because the guess becomes a fact in the paragraph above it.

## Phase D: Write

Read every explorer's report before you write. They overlap and will sometimes
contradict, and both are expected. Resolve a contradiction by reading the code,
not by preferring the more confident report, because a contradiction settled that
way is a hole in the explanation the reader cannot see.

Write it yourself, in this order, dropping what does not apply:

1. **What this is**, in one or two paragraphs, enough that a reader who stops
   here knows whether to keep going.
2. **The abstractions** needed to follow the rest, defined briefly.
3. **The flow.** The long part. What triggers it, what happens in what order,
   where the data goes, where the decision points are.
4. **Where it lives**, as a short file map, only the files somebody would open
   first.
5. **Gotchas**, when there are any.

Prose, not pseudocode. Name the file and the function so the reader knows where
to look, and paste a snippet only where the snippet is the point. Add a diagram
when several components hand data to each other and prose would force the reader
to hold all of it at once. Leave it out when the prose already carries the flow.
Carry the open questions into the writeup: a reader who finds out the explanation
hid a gap is worse off than one told where the map runs out.

## Phase E: Hand over

The explanation is yours to deliver. If a strong model drafted it from the
findings, read it, correct anything the code contradicts, and keep what holds. A
draft pasted out unread is a draft nobody checked. Then check the two or three
claims the reader is most likely to act on against the code, because those are
the ones where a wrong sentence costs something.

If the subsystem turns out to need a decision rather than an explanation, stop and
say so: that is `arena` when the shape is the hard part, and `blast-radius` when
the question is what changing it would break.

## Outputs

One explanation in the conversation, in the order above, with real paths, real
symbol names, and every open question named.
