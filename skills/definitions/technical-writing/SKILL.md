# Technical writing

Take a document to a tired engineer on the first read. Four passes do it, one
question each: what kind of document this is, how the sentence addresses the
reader, how much a sentence carries, and whether it reads two ways.

This file owns document structure and the layer the reader is in. `unslop` owns
the tells inside a sentence and `i-have-adhd` owns the shape of a message. Run
both over the result rather than reading either again.

## Start

1. Layer
2. Address
3. Load
4. Disambiguate
5. Cut
6. Ship

## Phase A: Layer

One document, one mode. Two questions pick it: does the content move the reader
through doing something or help them understand something, and does it serve
learning or work.

| | Learning | Work |
| --- | --- | --- |
| Doing | tutorial | how-to |
| Understanding | explanation | reference |

Use the same compass on one sentence that will not fit its paragraph. A
reference page that explains why is two documents, and so is a tutorial with a
parameter table bolted on. Split and link rather than blending.

**Tutorial.** Learning by doing. Say what the reader will build, not what they
will learn. Every step produces something visible, early, and name it: the
output line, the changed prompt, the log entry. Cut explanation to one clause
and a link. Write as "we", in commands.

**How-to.** Steps to a goal the reader arrived with. Assume competence. No
digressions, no background, no completeness for its own sake; link those
instead. Allow forks and judgment: "If you want x, do y." Name the page for the
task, "How to calibrate the radar array", not for the subsystem.

**Reference.** Facts for lookup. Describe, and only describe. No instruction, no
persuasion, no opinion. State facts, options, limits, and errors without
hedging. Mirror the structure of the thing described, and generate it from code
where you can.

**Explanation.** Understanding and the reasons behind it: design decisions,
history, constraints, the alternative that lost. One bounded topic, readable
away from the product, and the only mode where you may take a view.

## Phase B: Address

Talk to the reader as "you", in the present tense. "Will" is for things that
genuinely happen later. Name who does what: "the compiler checks", not "is
checked". Passive is fine when the actor is unknown or beside the point.

Write instructions as commands, and put the condition in front of the action so
a reader who does not need it skips it: "To delete the document, click Delete."
Common case first, exceptions after. Never "should be done".

Headings carry the point, not the topic: "Pick the mode first", not "Modes". A
task heading is a bare verb phrase, a concept heading a noun phrase. One h1 per
page, no skipped levels. Numbered lists for sequences, bullets for everything
else, introduced by a complete sentence, items kept parallel. Code in code font,
interface elements in bold. Link with the destination's name. Sound like a
knowledgeable colleague, and never write "please", "simply", "easy", or
"quickly" in an instruction: if it were simple the reader would not be here.

## Phase C: Load

One thought per sentence, and one instruction per instruction. Split an
instruction past about 20 words and any other sentence past about 25.

Put a warning before the step it guards. Keep the articles: "Remove backup file"
reads two ways and "Remove the backup file" reads one. Give each word one job
and keep it, so "check" never means restrain somewhere else. Pick one word per
action and stick to it: "start", never "initiate" three paragraphs down.

Mix lengths on purpose. A short sentence lands a point, and a long one that takes
its time carries a fact with its condition. One thought per sentence is not one
length per sentence.

## Phase D: Disambiguate

Keep "only" and "not" beside the word they change: "only fails on growth" and
"fails only on growth" are two different claims. Break up noun strings: "the
proto import budget check script" becomes "the script that checks the proto-import
budget".

Every "it", "they", and "this" points at one obvious thing, so repeat the noun
when in doubt, and never let "this" or "which" stand for a whole clause. Give
each clause a verb, because "Phase 1 moves the converters and Phase 2 the
runtime" leaves Phase 2 without one.

Say which parts "and" or "or" joins where a sentence can group two ways, with
"both...and", "either...or", or "if...then". Periods, not semicolons. A
parenthetical is a full unit or its own sentence, never a plural built with
"(s)". Write "a, b, or both" rather than "a/b".

One name per thing, everywhere. A document that says "the gate", "the ratchet",
and "the budget check" for one thing teaches three.

## Phase E: Cut

Cut every word that survives without it doing nothing. Take the everyday word:
use, help, do, start. A longer word has to buy its length with precision.

The codebase is the word list. Write the real symbol, file, flag, and command,
not a description of one. Do not coin a word for a mechanism: "move", "delete",
"a budget that only decreases". A fresh abstraction you find goes in your reply
as a proposed addition to the abstract metaphor rule in `unslop`, with the diff.
Do not edit that file.

When a rule makes the sentence worse, fix it another way or leave it alone. A
sentence that obeys every rule and reads as machine-written has failed.

## Phase F: Ship

A commit message and a PR description are documents too, and every pass applies
except the layer. A PR body is a briefing a reviewer reads in under a minute:
what changed, what it breaks, how to see it work. Link logs, diffs, and metric
tables rather than pasting them.

Make every count true at the commit that lands it, and name the command that
regenerates it. Indent code with tabs. Write real paths, so a reader can click
them.

Product interface strings are not documentation. They follow the product's own
copy guidelines.

## Outputs

One document in one mode, that a reader who has never seen the project can act
on after a single pass.
