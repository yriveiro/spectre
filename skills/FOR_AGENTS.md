# Working on `skills/`

Read this before writing a leaf. It states the body template, the two rules that
measurement put there, and the ports that are still open.

## The body template

Three parts. Two headers, and the second one is now optional.

```markdown
# Principle: <Name>

<three to five sentences. What the principle is, why it exists, and what it is
adjacent to. No header, because it is the paragraph you read first.>

## The moves

**A move, stated once.** Concrete enough to act on. A command or a literal
artefact name goes here, not above.

## What this principle is not

- **Not <the over-application>.** <why it is wrong.>
```

That last section used to be mandatory, and it was carrying weight it should not
have. A count over the nine sections found 49 bullets, of which 26 named a
specific action a reader would otherwise take and were doing real work, while 19
were the set parking claims it had nowhere else to put: eight copies of one
boilerplate preamble, nine variations on "not a gate" for a fact the hub now says
once, and two "not gatekeeping" lines whose missing principle had no test and so
could not be a leaf. Those are gone.

**The bar for including the section:** a line qualifies only if it names an action
the reader would otherwise take *and* the leaf's own positive text would not
prevent it. If every candidate is a handoff to another leaf, a restatement of
something the leaf already says, or an admission that nothing enforces this, write
no section. `principle-guard-the-context-window` ships with none and loses
nothing.

The moves section is one flat list. There is no altitude split, because a
principle stated as a value and again as a strategy and again as a tactic is one
claim written three times, and the third copy is the one a reader pays for.

A claim that belongs to another leaf does not get restated here. Name the owner
in one clause and move on, or drop it: `principle-hygiene` hands "one caller that
only forwards is dead code" to `principle-laziness-protocol` rather than
re-arguing it.

## The three rules measurement put here

All three measured with `ripwire --eval-skills` over a mirror of the bodies. The
figures below are dated because the corpus grows: they were taken on a
13-leaf, 54-row set, and the current numbers are at the end of this file.

1. **The description is the routing surface, so it names the moment and not the
   subject.** This is the one that costs the most and it is the one that is
   hardest to see, because the body is usually already right. Three of the four
   routing regressions in one session were a description that described its own
   principle, and all three were fixed by the same move:

   | leaf | what the description said | what the prompt said | delta |
   | --- | --- | --- | --- |
   | `principle-laziness-protocol` | "reader load, hops to trace, state to hold" | "impossible to follow", "one caller", "just forwards", "flatten it" | 48.8% to 60.5% desc, 0 of 6 rows won to 5 of 6 |
   | `principle-make-states-unrepresentable` | "a shape that cannot hold the wrong value" | "a boolean and a flag that must stay in sync", "a cast", "any" | 3 false fires to 1 |
   | `i-have-adhd` | "shape the message, lead with the next action" | "too long", "just the answer", "no preamble" | 0 of 2 rows won to 2 of 2 |

   The failure is the same every time. A description written about the principle
   competes with every other leaf on the principle's vocabulary, and a prompt
   carries the prompt's vocabulary. So: open with the moment, not the doctrine,
   and put the literal nouns in. "Hard to follow", "one caller", "just forwards"
   beat "reader load" every time, because those are the words in the prompt.
   Check a description by asking whether a real prompt's words appear in it. If
   not, the description is about the wrong thing.
2. **Do not cut a claim to save bytes.** Deleting the `Strategies` and `Tactics`
   sections outright cost 7.0 points of `bm25-full` hit@1, 46.5% to 39.5%. Folding
   those sections into one moves list, claim by claim, cost nothing: 58.1% desc
   hit@1, 0.704 mrr, 0.871 auc, identical to the five-section version, for 21% off
   one leaf and 12% off another. The redundancy was the problem, not the
   sections.
3. **Name the artefact, because the prompt names it.** The single row lost in the
   first fold was "update the README to say version 2.0.20". The five-section
   version spelled out "a supported-version floor, a dependency pin, a documented
   requirement, an inventory in a readme"; the fold compressed that to "every
   place it is written" and the row stopped routing. Put the literal nouns back.
   This is rule 1 at smaller scale, and it is listed separately because it is the
   first time it was caught.

## What the shape is not

A principle is not the only kind of leaf, and this template is not for all of
them. `no-comments` is a procedure and carries one `Steps` section with no
template. `principle-guard-the-context-window` is a compact port with no sections
at all. A shape that needs escape hatches is the wrong shape for the thing that
escapes, so check which kind of leaf you are writing before reaching for this.

## Porting a principle from elsewhere

`pstack` on the cursor/plugins repository is 47 skills, median 2,575 bytes, and
carries no template: each file is Why / Pattern / The test, shaped to its content.
That is the source. Porting one means four things, and skipping any of them is
how a port rots.

1. **Claim only unowned ground.** Roughly half of `pstack`'s principles restate
   each other. `principle-laziness-protocol` was six of seven bullets already held
   by `principle-hygiene` and `principle-laziness-protocol`, so the leaf that
   shipped holds the seventh and names the owner of the other six.
2. **Name the ripwire row, or say there is no instrument.** Every leaf gets a row
   in the map in `ripwire/SKILL.md`, and the count of rows whose answer is `none`
   has to match what `spectre-mode/SKILL.md` claims about it. Five leaves have no
   instrument today, and the count is five because four of the five rows are
   partial. `model-router` has no verb at all. `i-have-adhd` is judged by a person
   reading the message, with nothing mechanical in it at all now that the prose
   rules moved to `unslop`. `unslop` is greppable for two of its rules and has a
   mechanical check for rule 27.
   `principle-make-operations-idempotent` and
   `principle-outcome-oriented-execution` each name a partial instrument for half
   their test. Count the rows, not the leaves with nothing. The map is keyed on
   leaves, so a skill that is not one does not get a row and does not move the
   count.
3. **Do not import a mode or a workflow as a principle.** `architect`, `teach`,
   `swarm`, `why`, `how`, `unslop`, `automate-me` and their neighbours are
   procedures for a different harness. A leaf states a test and a moment you load
   it on, so a procedure for another harness has neither. Three of them shipped
   anyway, as skills that are registered and never indexed: `bro`, `arena` and
   `swarm`. They are in `definitions/index.ts` and in no trigger row, no index
   bullet, and no map row. That is the shape to reach for when a port is worth
   having and is not a principle, and it costs the set nothing, because the map
   and the index are what the leaf count and the routing surface are made of.

   Two facts every one of them needs, kept here so they are not copied into three
   files. They are registered only because `load()` dies on a body it does not
   list, and they are reader-called rather than model-routed because upstream
   ships `disable-model-invocation: true`, which is also why each description is
   written for the person choosing from the Skills dialog. Their ids are in the
   `notALeaf` set in `definitions/index.ts`, which is what a map row is checked
   against.

   `arena` carries one more, and it is the reason the name needs watching:
   `features/arena.md` reserves `arena` for an unbuilt feature that owns the key
   in `spectre.jsonc`, where the loader rejects it today. The skill reads the
   profiles that file already has. If that feature is built, the skill is what
   gives way.
4. **Then measure.** Add judged rows to `eval/fixture.ts`, and read the held-out
   slice rather than the whole set. A leaf that wins its own rows and costs
   somebody else's is a net loss, and the whole-set average hides that. The rows
   for a command the reader calls are `neg` rows, not judged ones: the claim
   under test is that the model does not reach for it, so a fire is a false-fire
   and the count to watch is the negatives it collects.

## The cost of a leaf, measured

Going from 10 leaves to 13 cost 9.3 points of `bm25-full` hit@1 on held-out rows,
55.8% to 46.5%, and no description rewrite recovered it. The new leaves took
prompts that belonged to their neighbours: "that function is unused now, remove
it" now routes to `principle-boundary-discipline`, and "you said nothing calls
that, prove it" lost `ripwire`.

That is about 3 points per leaf at the current set size, and it is the ceiling on
how many near-synonymous principles this set can hold. It is an argument for
fewer, sharper leaves, not more.

## The hub is the binding constraint

`spectre-mode/SKILL.md` is the index, and it grows by a trigger row plus a
paragraph per leaf: 634 bytes per leaf today. At 25 principles that is about
30,000 bytes of index in the one file that says "read this index, then load the
one leaf you need", which is a file nobody reads. Before the port goes past a
handful of leaves, the index entry has to become one line and the triggers table
has to stop growing.

## Measuring the routing, including with a model

BM25 is a lexical proxy. The thing that actually routes is a model reading the
same descriptions, so the eval asks both and prints them in one table. It lives
in `eval/` at the repository root and has its own README.

```sh
bun run eval -- --held-out
bun run eval -- --model=opencode/mimo-v2.6-flash-free
SPECTRE_EVAL_BASELINE=eval/baseline.json bun run eval -- --held-out
```

The decision graded is the activation, not the prose, because that is what
OpenCode routes on. Four kinds of evidence get four columns,
`skill/tool/text/silent`: an activation OpenCode recorded, a `skill` tool call,
prose naming an id, and nothing. A model that only answers in text stays in its
own column rather than being blended with the models that acted, because the two
are measuring different things.

The catalogue is checked against OpenCode's own `Registered skills` log line, not
`GET /api/skill`: the route is eventually consistent and settles at a fraction of
ours, and the session instruction entries come back empty. If the log line is
absent the eval refuses to score rather than grading against a catalogue nobody
confirmed the model was given.

Scores are not comparable across corpora, and these move as the corpus grows.
Measured on 2026-09-28 against 16 skills, `bm25-desc` scores 50.0% on the
held-out slice (22 rows) and 59.4% on all rows (75). Re-run the lexical arm
before quoting a number, and read which corpus and which slice it came from.
