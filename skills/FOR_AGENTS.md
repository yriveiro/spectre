# Working on `skills/`

Read this before writing a leaf: which of three shapes you are writing, the
template, the measurements behind it, and what a leaf owes the map and the hub.

A **leaf** is a skill this set routes to: 31 of the 77 definitions. 27 are
`principle-*`, and the other 4 are `grammar`, `communication`, `no-comments` and
`model-router`. The remaining 46 ids are in the `notALeaf` set in
`skills/definitions/index.ts` — the hub, the map, 23 `playbook-*`, and 20 more
procedures — and they are registered and read on demand, carrying no row.

## What you are writing

Three shapes, and picking wrong is the mistake that costs the most:

- **A principle** states a test and a moment you load it on. The template below
  is theirs.
- **A procedure** runs steps or phases. `no-comments` has one `Steps` section and
  nothing else; `why` and `blast-radius` run `Start` / `Phase A` … `Outputs`. A
  moves list that is really a step list is the tell.
- **A compact port** can have no sections at all, as
  `principle-guard-the-context-window` shows: one heading and no `##` under it.

**Register it or nothing loads.** `load()` scans `*/SKILL.md` under
`definitions/` and dies with `Add these to skills/definitions/index.ts: …` for
any body the array does not list, so one unregistered folder takes the whole set
down at startup. Add the import, add the value, and add the id to `notALeaf` if
it is not a leaf — `test/skills/ripwire-map.test.ts` fails on an id in that set
that names no registered skill.

## The body template

Two headers, and the second one is now optional.

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

**The bar for the second section.** A line qualifies only if it names an action
the reader would otherwise take *and* the leaf's own positive text would not
prevent it. If every candidate is a handoff to another leaf, a restatement, or an
admission that nothing enforces this, write no section.
`principle-guard-the-context-window` ships with none and loses nothing.

The moves section is one flat list. There is no altitude split, because a
principle stated as a value and again as a strategy and again as a tactic is one
claim written three times, and the third copy is the one a reader pays for.

A claim another leaf owns does not get restated: name the owner in one clause and
move on. `principle-subtract-before-you-add` opens by handing
deletion-first-as-reader-load to `principle-laziness-protocol`.

**The template is a target, not a description of the set.** 26 of the 74 bodies
still carry a what-not section and 22 carry `## The moves`. Four principles still
carry the five-section shape it replaced — `principle-boundary-discipline`,
`principle-evidence`, `principle-hygiene`, `principle-make-operations-idempotent`,
each with `Core values`, `Strategies` and `Tactics` where a new leaf writes one
moves list. Do not copy them.

## The three rules the measurements put here

Measured with `ripwire --eval-skills` over a mirror of the bodies — the call
`test/skills/routing.test.ts` makes — on a 13-leaf, 54-row corpus. **Figures from
a single session are not quotes.** Re-run `eval/` before you cite one, and say
which corpus and which slice it came from. The corpus has since moved: the set
is 31 leaves over 77 definitions and 85 judged-positive rows, so the figures below
are a record of what was true at 13 leaves, not a number to quote today.

**The description is the routing surface, so it names the moment and not the
subject.** This costs the most and is the hardest to see, because the body is
usually already right. Three of the four routing regressions in one session were
a description written about its own principle, and all three were fixed by the
same move:

| leaf | what the description said | what the prompt said | delta |
| --- | --- | --- | --- |
| `principle-laziness-protocol` | "reader load, hops to trace, state to hold" | "impossible to follow", "one caller", "just forwards", "flatten it" | 48.8% to 60.5% desc, 0 of 6 rows won to 5 of 6 |
| `principle-make-states-unrepresentable` | "a shape that cannot hold a wrong value" | "a boolean and a flag that must stay in sync", "a cast", "any" | 3 false fires to 1 |

The failure is the same every time: a description written about the principle
competes with every leaf on that vocabulary, and a prompt carries the prompt's.
Open with the moment, not the doctrine, put the literal nouns in, and check the
description by asking whether a real prompt's words appear in it.

**Do not cut a claim to save bytes.** Deleting the `Strategies` and `Tactics`
sections outright cost 7.0 points of `bm25-full` hit@1, 46.5% to 39.5%. Folding
those sections into one moves list, claim by claim, cost nothing: 58.1% desc
hit@1, 0.704 mrr, 0.871 auc, identical to the five-section version, for 21% off
one leaf and 12% off another. The redundancy was the problem, not the sections.

**Name the artefact, because the prompt names it.** The single row lost in the
first fold was "update the README to say version 2.0.20": the five-section
version spelled out "a supported-version floor, a dependency pin, a documented
requirement, an inventory in a readme", the fold compressed it to "every place it
is written", and the row stopped routing. Put the literal nouns back.

## What a leaf owes the map and the hub

- **A row in `ripwire/SKILL.md`**, keyed on the id: the instrument, or `none.`
  plus the floor there is. An id that cannot have a row belongs in `notALeaf`.
- **A `none` count the hub agrees with.** `test/skills/ripwire-map.test.ts` fails
  on a leaf with no row, on a row naming a leaf that no longer exists, on a
  `notALeaf` id naming no skill at all, and on a hub whose spelled-out number
  differs from the rows whose answer starts `none.` That number is a **word** in
  the sentence `names the … leaves with no instrument`, not a digit, and the test
  reads it with a regex that spans a line break. Count the rows, not the leaves
  with nothing: most of those rows still name a partial instrument in the prose,
  which is why the row is what the hub quotes. If you add a leaf, add its row and
  update the hub count in the same change.
- **A description.** `test/skills/routing.test.ts` fails on a blank one, and on
  `bm25-desc` or `bm25-full` stopping beating chance. The routing arm is skipped
  when `ripwire` is missing; the blank check always runs.
- **Registration**, as above.

Indexing is what the hub pays, and it is why the hub is the binding constraint: it
is the file that says "read this index, then load the one leaf you need", and one
that outgrows the message is one nobody reads. On this checkout the `## Triggers`
table and the `## Principles index` between them are 71% of the hub, over 14
bullets, and 16 of the 31 leaves appear nowhere in it (`TODO.md` tracks them). The
index entry has to become one line and the triggers table has to stop growing
before the set grows much more.

## Porting a principle from elsewhere

The source is `pstack` on the cursor/plugins repository, which carries no
template: each file is Why / Pattern / The test, shaped to its content. Porting
one means four things, and skipping any of them is how a port rots.

1. **Claim only unowned ground.** Read the port against the leaves already here,
   keep only what none of them says, and name the owner of the rest in a clause
   rather than re-arguing it.
2. **Name the map row, or say there is no instrument.** The obligations above
   apply to a port like any other leaf. A port with no row fails
   `test/skills/ripwire-map.test.ts`.
3. **Do not import a mode or a workflow as a principle.** `architect`, `teach`,
   `swarm`, `why`, `how`, `automate-me` and their neighbours are procedures for a
   different harness: a leaf states a test and a moment you load it on, and a
   procedure has neither. Forty-three ids are registered and never indexed, which
   is the shape to reach for when a port is worth having and is not a principle,
   and it costs the set nothing: the map and the index are what the leaf count
   and the routing surface are made of.

   Two facts they need, kept here so they are not copied into the definition
   files. They are registered only because `load()` dies on a body it does not
   list. And nothing in this set is auto-invoked — all 77 definitions carry
   `autoinvoke: false` — so the hub's trigger table is the only router there is,
   and a skill in neither the table nor the index is reached only by a reader who
   asks for it by name, which is why its description is written for that reader.
   Their ids are in `notALeaf`, which a map row is checked against.

   `arena` carries one more, and it is why the name needs watching:
   `features/arena.md` reserves `arena` for an unbuilt feature, and which of the
   two gives way is recorded in this file, rule 3. **If that feature is built, the
   skill is what gives way.**
4. **Then measure.** Add judged rows to `eval/fixture.ts` and read the held-out
   slice rather than the whole set: a leaf that wins its own rows and costs
   somebody else's is a net loss the whole-set average hides. The rows for a
   command the reader calls are `neg` rows, not judged ones — the claim under
   test is that the model does not reach for it, so a fire is a false-fire. The
   16 ported principles have no rows at all, so for those this step is not done.

## The cost of a leaf, measured

Going from 10 leaves to 13 cost 9.3 points of `bm25-full` hit@1 on held-out rows,
55.8% to 46.5%, and no description rewrite recovered it. The new leaves took
prompts that belonged to their neighbours: "that function is unused now, remove
it" now routes to `principle-boundary-discipline`, and "you said nothing calls
that, prove it" lost `ripwire`. That is about 3 points per leaf at that set size:
the ceiling on how many near-synonymous principles this set can hold, and the
argument for fewer, sharper leaves.

## Measuring the routing

BM25 is a lexical proxy; the thing that routes is a model reading the same
descriptions, so `eval/` asks both and prints them in one table.
`eval/README.md` holds the commands, the evidence columns, and why the catalogue
is checked against OpenCode's `Registered skills` log line rather than
`GET /api/skill`.

**The eval is blocked on a person today.** Delete the
`"plugins": ["github:yriveiro/spectre"]` line from
`~/.config/opencode/opencode.jsonc` first, or the run grades the installed copy
instead of this checkout and reports the 16 unmounted principles as missing.
`TODO.md` has it.
