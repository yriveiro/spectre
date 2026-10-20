# Ripwire

## What this skill is

A leaf of Spectre mode, and the only one that names a tool. One rule: **a
principle whose test can be run should not be asserted.**

Every leaf in this set states a test. Some of those tests have a command that
answers them. When one does, run it, because the answer is a fact and the
assertion is a hypothesis. This skill is the map from principle to command.

It also states the other half, which is the half that keeps the map honest: where
ripwire is wrong, what its silence means, and which moments belong to one of the
sixteen moment-skills ripwire installs rather than to a verb you run by hand.

## The rule

Name the principle. Name the test it states. Name the verb that answers the test.
Run it. Report what it said.

```text
principle-verification: its test is "which claim no longer holds"
verb: ripwire --doc-drift
result: two anchors in README.md no longer resolve
```

Write the leaf name and the verb down, because a step you cannot fail is a step
nobody runs. If no verb answers the test, write `no instrument` and say what
stands in for it. That is a complete answer, and it is more useful than a
principle quoted at something it was never about.

## The map

Keyed on the test, not the name. The test is the falsifiable half.

| Leaf | Its test | The verb that answers it |
| ---- | -------- | ------------------------ |
| `principle-laziness-protocol` | where does X come from, what can change it, and what would a deletion have avoided | `--callers` `--uses` `--context-ratio` `--nonlocal-state` `--map-diff` `--clones`, `--for=TASK` for the ranked set a reader would have to read, and `--graph-query=EXPR` for the question those seven cannot phrase, which filters a node set by kind, complexity or fan-in and then walks it. |
| `principle-verification` | which claim no longer holds | `--doc-drift` `--mentions` `--test-gate`, and `--verify=contains(FILE,"LITERAL")` for the single anchor you are holding rather than the whole corpus. That FILE is a substring over the indexed tree, so it finds a file this repository indexes and nothing else, and a literal cannot hold a `"`. A markdown link to a heading is an edge now, so `--doc-drift` checks a claim about a section and not only about a file. |
| `principle-evidence` | can this check fail, and has it ever | `--verify=CLAIM` asks the question and returns confirmed, refuted or not-established, over a closed claim language: `calls`, `uses`, `unused`, `contains`, `defines`, `reaches`. A refuted verdict is the proof the check can fail, so this is the row's own test turned into a command. `--seams` gives the complement, which is the edge no test reaches, and `--exercises=FILE` says what one test covers. `--path=A,B` answers a reachability claim with its gaps named: where the graph holds no edge it says where the search stopped. Whether the instrument itself is right is a person. |
| `principle-make-states-unrepresentable` | can I write a comment saying when this combination of fields is valid | `--seams` names the untested shapes, and the typecheck is the oracle. Whether a sum should have been a union, or whether a struct admits a state nobody can name, is a person reading the type. `--clones` catches the two hand-written copies of one shape. |
| `principle-boundary-discipline` | where did this value enter, and which checks sit below that point | `--uses` `--callers`, `--impact=TYPE` for the symbols that name a type in a type position, `--grep`'s `reads=` and `vals=` for where a stored value goes, and `--arch=FILE`, which enforces layering rules from a rules file and exits 2 on a violation. That last one is the difference between a boundary rule and a paragraph about one. |
| `principle-hygiene` | what does nothing reach | `--safe-delete=SYM` answers it in one call: callers, blast radius, uses, test coverage, a `risk=` and a `dead_code_candidate=`, plus the one pasteable follow-up in `next=`. A `risk=` of `hedged` is what a method a constructed name could reach reads, and `pattern_dispatch=N` names the sites. `--dead-code` `--clones` `--lint` name each family separately. |
| `principle-migrate-callers-then-delete-legacy-apis` | does any caller still reach the old path | `--callers` `--whereis`. A caller list that fits 16,000 B is served whole, and a cut one names the next page in `next=`, so the follow-up starts where the page stopped. |
| `principle-test-behavior-not-implementation` | would this test pass if every import returned undefined | `--test-gate` names the tests; the mutation itself has no verb here. `--seams` gives the complement, which is the test that should exist and does not. |
| `principle-test-for-truth` | which defect does this test catch, and what does it cost to keep it | `--exercises=FILE` says what one test file reaches, and `--safe-delete=SYM` says what reaches the code when it goes, which is how you price the test that guards it. `--test-gate` names the tests a change has to run and the untested blast radius it leaves. The mutation, the triage order, the floor and the judgement about a low-probability scenario have no verb here. |
| `principle-outcome-oriented-execution` | is the named end reached, and did a check at the boundary | none. Whether a declared end was reached is a fact about a plan and a diff, not about a graph. The reachability half has an instrument: `--callers` on what the end says should be gone, and `--test-gate` for the check the boundary was supposed to run. Whether the plan still means anything is a person reading it. |
| `principle-make-operations-idempotent` | does the second run converge to the same end state | none. Convergence is a property of a run, not of a graph. The reachability half has a floor with `--exercises=FILE`; whether the second run agrees with the first has no oracle here. The check is running the thing twice, and crashing it on purpose. |
| `code-hygiene` | does the comment say what the name does not | `--comment-coherence` |
| `principle-guard-the-context-window` | what did this cost | `--token-budget` and `--pack-task`, whose answer states `est_tokens=` against `budget_tokens=`. `--pack-top-n` is its deprecated alias. On `--for` an explicit `--token-budget` is a soft target, not a cut: every row it drops stays reachable through `next=`. `--partition=N` carves the same task into N minimally-overlapping slices for N agents; read `overlap_max` before trusting them. |
| `grammar` | does the sentence name one actor, and is this the plainest word | `tools.spectre.prose` on the body: semicolon, phrasal verb, nominalization, marketing adjective, long sentence, passive voice. Four are hard and two advisory, so a clean run is not a clean sentence. The present perfect is advisory because it can carry a hedge the simple past cannot. Whether a sentence lands, whether a word sounds bigger than the fact, and whether a heading says what is under it are a person reading the page. |
| `model-router` | none | none. The allowlist in `spectre.jsonc` is the check. |
| `principle-attack-the-premise` | do not start the next fix before the premise is written down and the failures counted | none. The count spans sessions and no verb reads it. What a verb does give is the premise's blast radius: `--callers` on the symbol every failed fix touched, which is how you notice the fixes were all in one place. |
| `principle-build-the-lever` | did the diff contain the codemod, script, generator, or delegate the work needed | none. Whether a lever was built is a fact about a diff, not a graph. `--map-diff` names the files the change spread across, and `--cochange --cochange-groups` names the file to fix when a group of them has always moved together. A floor, not the test. |
| `principle-encode-lessons-in-structure` | is the recurring instruction a rule, a check, or a script now | `--lint` for the rule that now exists, `--lint-catalog` for the 39 built-in ones readable with no corpus at all, and `--lint-rules=DIR` for this repository's own rules as files. `--clones` catches the second hand-written copy of the prose a rule replaced. Two of those are gates rather than reports: `--arch=FILE --baseline` accepts current debt and then fails on new crossings, and `--doc-drift --gateability` turns "CI stays non-gating" into a list that can be finished. Whether the lesson was worth encoding is a person. |
| `principle-exhaust-the-design-space` | were two or three competitors built and compared on the same evidence | `--dmm=A..B` scores any two refs as one number in [0,1], split per property, which is what makes two prototypes comparable on one scalar instead of two readings. `available="0"` answers UNAVAILABLE and must not be read as 1.000 or 0.000. Whether the space was wide enough is still a person. |
| `principle-experience-first` | none | none. Delight is a person judging the result and there is nothing to count. The line it draws is against shipping more, which is `principle-laziness-protocol`'s question rather than an instrument. |
| `principle-fix-root-causes` | did the fix land at the cause, or is it a guard | `--callers` and `--whereis` to walk from the symptom to the cause, and `--path=SYMPTOM,CAUSE` for the near-miss the graph does not hold. Whether a guard is a guard or the cause wearing a disguise is a person reading it. |
| `principle-foundational-thinking` | does every subsequent phase benefit from this existing | none. It is a claim about the future made before the future exists, so no verb has a phase to read. The scaffold it produced is judged afterwards by every other leaf. |
| `principle-minimize-reader-load` | can a new reader answer where does X come from and what can change X in under thirty seconds | `--context-ratio` and `--nonlocal-state`, the two verbs `principle-laziness-protocol` also claims. Shared rather than duplicated; this leaf is the narrower claim, the two axes named as axes. |
| `principle-model-the-domain` | does a new feature grow the if/else chain by one branch | `--clones` for the same domain rule hand-written in two places. Which structure a domain wants is a person reading it, and `principle-make-states-unrepresentable` owns the shape half. |
| `principle-never-block-on-the-human` | is the next action reversible | none. Reversibility is a property of the blast radius, which `--safe-delete=SYM` bounds better than `--callers` alone: it reports the radius, how much of it a test reaches, and a `risk=`, and none of those decide it. The judgement to proceed is a person. |
| `principle-prove-it-works` | was the real artifact checked, or something standing in for it | `--test-gate` names the tests that would have to run and `--seams` names the untested edges where a proxy gets substituted. Whether the check touched the real thing is a person. |
| `principle-redesign-from-first-principles` | if we were writing this from scratch with this requirement, what would we build | none. The counterfactual is a design nobody wrote, so there is nothing to point a verb at. `--clones` catches the bolted-on special case once it exists. |
| `principle-separate-before-serializing-shared-state` | is there more than one writer, and is the second one structural | `--nonlocal-state` for the mutable state a symbol can reach. Whether serializing it is a real invariant or a missing split is a person. |
| `principle-sequence-verifiable-units` | does each unit end at a check that actually ran | `--test-gate` names the tests a boundary should have run and `--affected` names which of them this change makes relevant. Whether the unit was small enough to bracket is a person. |
| `principle-subtract-before-you-add` | what would a deletion have avoided | `--dead-code` and `--clones`, the floor `principle-laziness-protocol` also claims. This leaf is the narrower one: the deletion happens before the addition is designed. |
| `principle-type-system-discipline` | can I write a comment saying when this combination of fields is valid | the typecheck is the oracle and `--seams` names the untested shapes. Which flag to turn on, or whether a sum should have been a union, is a person reading the config. `principle-make-states-unrepresentable` owns the language-agnostic claim. |

Two rows worth reading twice, because they are the strongest instruments in the
set and neither is obvious from its name:

- **`--context-ratio` is reader load, measured.** It reports, per symbol, how
  much a reader must know that is not in front of them: the in-corpus
  definitions the symbol's references resolve to, and the share defined outside
  its own file. As an edge count and as `read_ratio=`, weighted by the tokens a
  reader actually has to read. This is the two axes of
  `principle-laziness-protocol` as numbers, which is what makes that
  principle's test answerable instead of a judgement.
- **`--nonlocal-state` is the state axis alone.** Per function, the non-local
  mutable state it can reach, most writes first. A function whose `writes=` list
  is long is a function the reader must hold state for.

## Two ways in

**The MCP server**, as `tools.ripwire.*`. Thirty-three tools: thirty-one verbs,
ranked, with lazy handles, plus `batch` (sixteen read sub-queries in one turn)
and `explore` (one-call orientation with bodies attached). Prefer it when the
session has it, because it ranks and it batches.

**The CLI**, as `ripwire <dir> --flag`. Same engine, and it is the only place
`--test-gate` lives, so the exit-code gate that `ripwire-quality-bar` pairs with
`--quality-delta` is a shell command. Two more live only here: the `--for` body
fold, which the MCP `for` does not serve, and `--quality-delta=A..B` with the
`--quality-kinds` replay. Use the CLI when you need a script, an exit code, or
one of those.

A `--quality-delta=A..B` answer that ran out of memory is a partial answer and
not a pass: it exits 2 when a kind that ran gates, 6 otherwise, and 5 when even
the changed files did not fit.

Both answer from the same index, so a verb is not a second opinion on the other
one. If they disagree, the index moved between the calls.

## Where ripwire is wrong

The instrument is not the principle, and a map that only says "run this" teaches
deference to a tool, which is the failure `principle-evidence` exists to prevent.
What it will not tell you.

**Zero means none found, not none exists.** A count is a floor, never a total.
The index skips files it cannot parse and files above a size limit, and an
unresolved call in a language the parser reads partially is a missing edge, not
an absent call. Run `--skipped` to get the list of what was dropped. A verb that
returns nothing has told you the index does not know, which is a different
sentence from "it is not there". The graph verbs now publish three gauges beside
the count, so the floor can be read rather than assumed: `graph_ambiguous=` is
the calls split over several definitions, `graph_unresolved=` the ones with
in-tree evidence and no edge, and `graph_unindexed=` the files no grammar could
read. Measured with `--seams` on this repository at 0.6.8 they read 5, 232 and 4.
The gauge is per-verb rather than per-tree, because each verb resolves the edges
it needs: `--safe-delete` reports the same `graph_unresolved="232"` here. Read
the gauge on the verb you ran.

**The index is a snapshot.** It is built at a point in time. After you edit, a
call from the server may still describe the code before your change. The server
also ships three edit verbs (`insert_before_symbol`, `insert_after_symbol`,
`replace_symbol_body`), so a session can change the code and keep asking the old
graph. Re-index, or read the file.

**A hedge is not an edge.** 0.6.8 names what it declined to bind, and a name is
not a proof. A call the resolver could not bind is a `<dc>` row, a candidate set
rather than a call, and `--impact` prints the `<dc>` rows of the calls it
counted and declined. A `--path` answer with no edge carries a
`<bridge proven="0">` and a `<near_sink>`, and both are hedges: `reachable=` and
`hops=` stay 0 and no count includes the bridge. An edge matched by name alone
carries `via="name"`, one the resolver split carries `prov="split"`.
`--safe-delete` reads `risk="hedged"` for a method a constructed name could
reach, with `pattern_dispatch=N` naming the sites. A hedge is where the index
stopped, not the edge it did not find.

**The head of a `--for` answer is breadth, not score.** The first eight rows
take one row per distinct file, so rank 1 to 8 is a tour of eight files and not
the ranking. `<sigs files_first=N>` counts the rows that moved, and the body
fold and the compact `<hops>` keep score order. A file that scores highest can
sit at row 12. The fold serves a body whole or not at all: a class too big for
the budget comes as a `<slice>` of its constructor and the members the question
names, so a body in the answer is not the whole definition.

**A declaration file ranks below the implementation it ships with.** A `.d.ts` or
`.pyi` row is ranked lower when the package that holds it also ships the
implementation, so a ranked answer can leave a type declaration out on purpose.
A package that ships types only keeps its rank.

**Some lenses are disclosed approximations, and the help says which.**
`--biggest-first` runs one token-class table across every language.
`--readability` is its deprecated alias and no longer appears in `--help`, so a
reader who looks for it there concludes the flag is gone while the binary still
answers to it. `--metrics` states in its own text that coupling is the validated
signal and complexity is a size-correlated one, so treat a complexity number as a
size proxy and a coupling number as a finding. Where a flag publishes its own
error bar, read it before quoting the number.

**A quality family can be unavailable, and absence from the report is not health.**
`--quality-panel` joins six evidence families and names the ones it could not
measure, with a reason each. Measured here at 0.6.8: it reports
`unavailable="confusion,state"` and says why, because the `confusion` family is an
atom pack that reads C/C++/ObjC/CUDA paths only and the `state` family analyses
C++/ObjC only. This tree is TypeScript and indexed no such file, so four of six
families were live. A preset that cut at two families would have ranked on two.
Read `unavailable=` before quoting `ranked=`.

**`--help-task` abstains more often than its description suggests.** It is the one
flag whose job is to name the verb for a task, and it answers
`status="abstain" confidence="none"`. Measured here at 0.6.8: it abstained on
"which ripwire command answers can I delete this symbol" and on "is it safe to
delete ledger", the second with `resolved_symbols="0"`, so naming an indexed
symbol did not buy a recommendation. Ask it, and treat an abstention as the
answer it is. This map is the fallback for the questions it declines.

**`--dead-code` has a known false-positive class.** A symbol registered by a
self-registering test or benchmark macro (doctest, gtest, Catch2, Google
Benchmark) has no caller a name-based call graph can see, so every one of them
would be reported. The flag exempts those four frameworks, and `.ripwire_config`
extends the list. A dead-code hit in a test-heavy tree is worth one look before
you delete anything.

**A path in a doc is not always a claim about this repo.** Measured here, not
assumed: `ripwire . --doc-drift` on this repository reports 55 failed anchors
across nine documents, and every one of them is a path that is not this repo's.
Fifty-three name a file that does not exist here: `features/model-routing.md`
carries 22 of them, and it cites `packages/core/src/tool/plugin/subagent.ts` at
seven rows of its table, which are OpenCode's source paths and not this repo's.
Two name a symbol this repo does not define (`noImplicitOverride` and
`exactOptionalPropertyTypes`, a TypeScript compiler option each).
`communication/SKILL.md` quotes two paths that are examples inside a prose rule
(`src/auth.ts:42` and `auth.spec.ts:42`), and this file quotes one of them to
show the class, so it keeps reporting one of its own. The verb reads a path in
backticks and looks for it here, so a doc quoting another project, or showing a
path inside an example, comes back as rot. Open a hit before you act on it.
`--with-history` separates the other false class, a name this repo never had,
from one that was deleted.

## Hand off to the moment-skills

Ripwire installs sixteen skills of its own into `~/.local/share/ripwire/skills/`,
one per moment, and they carry the long form of what this table summarises. The
moment → skill map is `ripwire-router`'s job and it keeps itself current, so when a
moment is one of those, load it from there rather than reading a second copy of
that routing here. Two of the sixteen are worth naming from this side:

- `ripwire-quality-bar` owns the moment you think you are done, and it is what
  `--test-gate` exists for, since that flag lives only in the CLI.
- `ripwire-mcp` holds the server's own wiring, including staleness and rebuild
  behaviour, and is worth reading once if you use the server heavily.

A seventeenth skill ships in the same tree, `ripwire-opt-remarks`, and a plain
install skips it: it is about compiling ripwire itself, so it says nothing about
running it.

Nothing above is a substitute for the row it replaces. This file maps a
**principle's test to a verb**; `ripwire-router` maps a **moment to a skill**. The
two answer different questions, and a verb is the cheaper answer when the question
you have is which measurement would settle a claim you are holding.

## Checking this repo's own routing

`--eval-skills` scores which skill fires for which prompt, against a random
floor, with a per-skill blame table. It reads a skill's description from the
YAML frontmatter of its `SKILL.md`, and this repo keeps the description in
`index.ts`, where OpenCode reads it. So the verb sees every spectre skill as
undescribed unless something adds the frontmatter for it.

`test/skills/` does that. `mirror.ts` loads the definitions and writes a temp
tree whose `SKILL.md` files carry frontmatter built from the same objects
OpenCode gets, so the description cannot drift. `routing.test.ts` asserts the
mirror is complete, that no skill reads as undescribed, and that both
description-based and full-text routing beat chance. `fixture.ts` holds the
labelled prompts. Change a description, run `bun test`, and the numbers move.

Routing is good at rank one and better at separation, and the gap is
vocabulary rather than structure. The corpus has three slices and they answer
different questions, so read the slice before the number. Measured with
`ripwire --eval-skills` over the mirror of the 82 bodies at ripwire 0.6.8:

| slice | rows | hit@1 | AUC | what it reads |
| ----- | ---- | ----- | --- | ------------ |
| `tuned` and `heldOut` | 171 | 99.3% | 0.955 | in-sample, because these rows shaped the descriptions |
| `heldOut` | 31 | 100% | 1.000 | frozen and saturated, with four judged rows now inside a description |
| `blind` | 37 | 54.5% | 1.000 | fresh rows that no description has seen |

The first line is the number the corpus inflates by construction, so quote the
blind slice instead. It reads 54.5% at rank one with 1.000 AUC: the right leaf
sits near the top of the ranking and loses first place to a neighbour most of
the time. Full text is weaker than the description alone (68.0% and 0.816 over
the whole set), and the routed task lens sits between the two (58.2%, 0.865).
Every skill with permitted rows wins at least one, and no skill fires on more
than one row that is not its own.

What survives in the misses is nouns. "bump effect to the latest rc" does not
match a description that says "a dependency on an old version". Leading with
the moment fixed the register and left the everyday words missing, and the
blind slice is where that gap shows up, because a fresh prompt carries the
words of the moment and not the words of the description.

Four held-out rows now sit inside a description, so the held slice is a read on
24 of its 28 judged rows and not 28, and all 24 read right. Before this change
the set outside the descriptions held a 25th row, the migrate row, and it read
wrong: the hygiene description borrowed its words in a hand-off clause. Dropping
the borrowed words fixed a row no description names, and that is the kind of move
an honest read can trust. The four rows inside a description are the `ripwire`
reachability row, the two `principle-test-behavior-not-implementation` rows, and
the hygiene row about an unused helper. Each moved on the leaf's own body
vocabulary and not on the row's: the body says `--path=A,B` answers a
reachability claim and carries `reachable=`, it names the shape "Constant pin"
and lists "a config default", it says a green suite that cannot fail for a
defect is evidence about nothing, and it lists "a helper kept just in case". The
words "the retry logic" and "timeout" sit in no description.

The blind slice holds the corpus to a bar the other two slices cannot meet.
`eval/tests/fixture.test.ts` fails when a row shares a four-word run with the
description of the leaf it names, so a leaf cannot win a row by quoting itself.
The 37 rows cover the seven leaves the corpus never covered, twelve boundary
rows that each have a neighbour the router could pick instead, and four rows
that name no leaf at all. The read at this commit puts 18 of the 33 judged rows
at rank one: 14 of the 21 rows for those seven leaves, and 4 of the 12 boundary
rows. Seven of the 18 leaves with a row here win none of it, and every one of
them had tuned rows before the blind slice existed. The words those prompts use
are absent from the descriptions, and that absence is what the corpus phase
closes.

A row in the blind slice gets read once. When a description changes because of
one of those rows, that row stops being blind, so it moves into `tuned` and a
fresh row takes its place.

The routing test asserts none of the per-skill numbers. A per-skill win rate
is a number that moves when any description is reworded, and a gate on it would
be red for a reason nobody can act on in the moment they see it. The AUC floors
are the stable claim: the arm is better than chance, and the descriptions are
visible.

## What this skill is not

- **Not a substitute for the leaf.** It routes to the verb. The judgement about
  what the number means belongs to the principle, and a number with no principle
  attached is a fact nobody acted on.
- **Not a claim that the tools are accurate.** Every row here is a place to
  measure, and the section above is the list of ways the measurement misleads.
- **Not a reason to run ripwire on everything.** The map has thirty-one rows.
  Nine of them answer `none`, and twenty-two name a verb. Running a verb because
  it exists is the same as asserting a principle because it sounds right.
- **Not portable to a machine without ripwire.** This skill names a tool on
  purpose, which the principles themselves are written not to do, because naming
  the instrument is this skill's entire content. If ripwire is not installed,
  every principle still stands and this file is the only thing that stops
  applying.
