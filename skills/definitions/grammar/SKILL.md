# grammar

The rules of ASD-STE100 Simplified Technical English, plus the tells the standard
does not cover. One word, one meaning, one named actor, one claim per sentence.

Load this when the text reads wrong and you cannot say which part is wrong: a
sentence too long or hard to parse, nobody named as the actor, the wrong tense, a
word bigger than the fact, one thing going by several names, a document that is a
wall of text, a heading that is just a noun, a list of fourteen items, or a
semicolon holding two clauses together.

STE wins every contradiction with a local rule. Where it does, the local rule is
gone rather than negotiated, and what survives here is what STE does not cover. STE
is a floor rather than a ceiling: it governs aerospace maintenance prose and is
silent on developer prose, so the residue below carries its own numbers rather than
one from the standard.

The dictionary is absent. Issue 9 restricts reproduction of its ~900 approved
words to eight categories of organisation, and this project is in none of them.
What carries instead is the principle underneath: the plainest available word, and
the same word for the same thing every time.

## Why this body trips its own linter

`tools.spectre.prose` reports the marketing adjectives in the section below, and it is
right to. They are the list of the words the rule bans, so naming them is the rule.
The only way to clear the finding would be to stop naming them, which would leave
the rule unusable.

Every other hard rule is clean in this file, and the passive-voice findings are
advisory: the actor is genuinely irrelevant in a sentence about how a prompt reads.

## What has an instrument

`tools.spectre.prose` checks the mechanical half. Six rules: semicolon, phrasal
verb, nominalization, marketing adjective, long sentence, and passive voice. Four
are hard and two are advisory, so a clean run is not a clean sentence.

```js
await tools.spectre.prose({ targets: ["skills/definitions/grammar/SKILL.md"], disable: ["marketing-adjective"] })
```

That one disables the marketing adjectives, because the section below names them
and naming them is the rule. Every other hard finding in this file is a real one.

Advisory means a finding that never fails anything: passive voice, because "is
left" is correct when nothing did the leaving, and the present perfect, because
`has not been read at source` carries a hedge the simple past cannot.

The rest is a person reading the page. Whether a sentence lands, whether a word
sounds bigger than the fact, and whether a heading says what is under it have no
command that answers them. `ripwire/SKILL.md` records that as `none`, and the
floor is that the reader decides.

Two rules are deliberately not implemented, because a regex cannot do them
without constant false positives: capping a noun cluster at three words needs
part-of-speech tagging, and spotting a dropped article needs semantics. Both are
in the sections below as judgement.

The sections below are grouped by what they fix, not by what a prompt looks like.
A prompt naming a long sentence is a sentence rule. A prompt naming marketing
adjectives is a word rule. The grouping is for a reader who already knows which
one they are looking for, not for the router.

## Never change a fact to fit a word

**Test: after the rewrite, does the text still say what it said before?**

The standard removes ambiguity, not content. A sentence of approved words that
states something false is a worse failure than a sentence with one unapproved
word. The dictionary constrains the wording of a fact, and never licenses a
change to the fact.

Every word rule below is under this one. When no approved word carries the
meaning, four moves, in this order:

1. Restructure the sentence so approved words carry the idea in a different
   shape. Most cases end here.
2. Use an approved verb phrase rather than one word: `get access to` for
   `access`, `make sure that` for `check`, `find the cause of` for `diagnose`.
3. Declare a technical noun or verb from the project glossary and record it.
   That is STE 1.5, and it is the move that makes the rest of the standard usable.
4. Keep the accurate word and flag it, with the reason, in what you hand back.

The move that is forbidden is taking the nearest plain word and accepting the
shift. The result looks compliant and reads plausibly, which is why it survives
review. A limit on how much data can be lost after a failure became a limit on
how much can decrease, because `decrease` was plain and `loss` was not. The
sentence was compliant and wrong. Data is not smaller after a failure. It is gone.

**Test every substitution, not only the hard words.** Write the source word's
meaning in context, in your own words. Write the candidate's single approved
meaning. If the two are not the same, the substitution is invalid, and you are
back at move one.

Near misses are worse than distant ones, because they survive a quick read.
`stop` for a failure, because a stop can be intentional and a failure cannot.
`find` for monitoring, because finding is an event and monitoring is continuous.
`change` for a migration, because the source named one specific operation.

Never invent a ruling to justify a substitution. If you did not check the
candidate against a dictionary, say that you did not.
`tools.spectre.prose` reports a missing entry as `unknown` rather than as not
approved, and that distinction is the whole point.

**Before and after a rewrite, list the propositions.** Each fact, each relation,
each qualifier. Then check the output against the list: nothing dropped, nothing
altered to fit a word, nothing added that the source did not say, every hedge
still there, and every object of a transitive verb still attached. A rewrite
that fails any of those is not compliant, whatever its word list says.

This branch borrowed this section and cut it down. The source is
`references/meaning-fidelity.md` in `nuelcyoung/asd-ste100`, which is the
counterweight that repository's `dictionary.md` and `pos-analysis.md` need and
this one lacked. Its worked example is aerospace, so what came across is the rule
and not the RPO paragraph.

## Active voice, and name the actor (STE 3.6)

**Test: who is doing this, and did the sentence say so?**

STE requires the active voice in a procedure. In descriptive text, passive is
correct only when the actor is unknown or irrelevant to the reader.

The rule this set did not have before: **the actor is named, not implied.** "The
state is synchronized" names nobody. "The tool synchronizes the state" names
the actor. "The system handles it" is the worst of the three because it looks
specific and is not.

This is the rule that matters most for a model reading the sentence. Passive
voice costs a human a re-read. An unnamed actor costs a model a guess, and a
model cannot call to ask.

Bad: `State is validated before the write proceeds.`
Good: `The compiler validates the query before the write proceeds.`

`tools.spectre.prose` reports `passive-voice` as advisory, because "is left" is
correct when nothing did the leaving.

**Naming the actor is not free.** The standard asks for the active voice in
descriptive writing as much as possible, not at any cost. The passive is correct
when the actor is unknown, when the actor does not matter to the reader, and when
the active would force you to name someone the source never named.

Inventing a subject to escape the passive is a fabrication. "Backups should be
taken frequently" never says whose obligation a backup is, so "The teams must
take backups frequently" adds a fact.

If a passage needs an actor on every sentence and the source supplies none, the
passage is a procedure wearing descriptive clothes. Reclassify it and use the
imperative, which removes the passive and the invented actor at once.

## Simple tenses (STE 3.2)

**Test: is the compound tense carrying something the simple past cannot?**

Permitted: infinitive, imperative, simple present, simple past, simple future,
past participle as an adjective. Banned: present perfect, past perfect, compound
auxiliaries.

Banned: `We have received the report.`
Allowed: `We received the report.`

**This is the one place the standard does not win, and the reason is a claim
rather than a sentence.** `The hook has not been read at source` and `The job
has completed` say something the simple past cannot. Present perfect marks
current relevance, and current relevance is the point. Rewrite as `The report is
not verified at source` and the meaning survives.

So: simple past where the simple past is true, compound where the relevance is
the claim. `tools.spectre.prose` reports `present-perfect` as advisory for this
reason.

## Length

**Test: is the sentence over 25 words?**

STE caps instructions at 20 words and descriptive prose at 25. The linter
enforces 25, because telling a procedure from a description needs a context it
does not have. The 20 is a judgement.

Under STE 8.4 to 8.7 an inline code span, a link and a hyphenated compound each
count as one word, so a long snippet does not make a short sentence long.

Measured on this set before adoption: 7 sentences over 25 words across 79 files.
This is not the expensive rule it looks like.

Meet the limit by splitting, never by deleting. When a sentence will not fit,
ask which proposition needs a sentence of its own. Never ask which words can go.

A rollback is a possible step when a release caused the incident, and it does not
help when a data migration caused it. Cutting that to "A rollback is a possible
step" keeps every approved word and loses the condition, which was the point.

## One instruction per sentence (STE 5.2)

**Test: does the sentence ask for two things?**

`Open the file and read line 3, then check it against the spec` is three
instructions in one sentence. Split it, or make it a numbered list.

Judge by the count and not by whether it reads well in one pass. A reader cannot
compute whether a sentence lands, and a rule a reader cannot compute is a rule
nobody applies.

## No semicolons (STE 8.1)

**Test: is there a semicolon anywhere?**

STE bans the mark outright. Rule 8.1 permits every other standard punctuation
mark, so the em dash is legal and stays legal here.

Bad: `The agent deletes the file; then it logs the path.`
Good: `The agent deletes the file. Then it logs the path.`

The em dash is permitted, because rule 8.1 permits every other standard mark.

Measured on this set before adoption: 168 semicolons in prose across 79 files,
and 0 inside a code fence or a table row. This is the rule that costs the most,
and it is one character per finding.

The branch that adopted this paid 191 of them across 63 files, which is 23 more
than the 168 because the sweep went past the set of skill bodies and into
`features/`, `eval/` and the two `FOR_AGENTS.md`. `test/tools/prose.test.ts`
reads the whole repo and expects zero, so a new file cannot bring one back
quietly. Four of the sentences held five or more items in a list, and those
became lists rather than a run of full stops, which is what STE 4.3 asks for.
The rest were a contrast or two instructions where the mark was doing the work
of a full stop.

## Keep the subject, the verb, and the article (STE 4.2, 4.5)

**Test: was a word dropped to make the line shorter?**

Bad: `Files not backed up will be lost.`
Good: `The tool does not back up files. Files that are not backed up are lost.`

A dropped word spends the budget the work needs, so put it back.

The rule keeps articles. It does not add wrong ones. `use` is uncountable in
this sense, so "a high CPU use" is wrong and "high CPU use" is right.

## Keep modality exactly (STE 3.2)

**Test: does the rewrite still say what the author was confident about?**

`May have failed` and `failed` are different claims. A hedge is the author's
stated uncertainty, and it is content.

`tools.spectre.prose` never flags `may`, `might` or `could` at all. A linter that
pressured hedges out would rewrite claims into facts.

This set decides against the standard here, so it is worth saying why in one
place. The standard approves `can` and `must` and does not approve `may`, `might`
or `could`. Its reason is that a technician must not act on an unverified claim.
That reason does not transfer. Here a hedge is the writer reporting the limit of
what they checked, and deleting it does not make the claim more true. It makes it
a fact nobody established.

The STE-purist source agrees on the outcome by a different route. Its Pass 1
holds that every hedge must survive, and its worked example deletes a modal that
was itself approved, which it still calls a meaning failure.

So: hedge down to one qualifier, never to zero. "Could potentially possibly be
argued that it might" becomes `may`. "May have failed" stays.

## One word, one meaning (STE 1.1 to 1.3)

**Test: does this paragraph use two words for one thing?**

`Protagonist`, `main character`, `central figure` and `hero` in one paragraph
are four words the reader must map onto one referent. Pick one and repeat it.

One term, one concept. Once a thing is called `the leaf`, it is `the leaf` for
the rest of the document. `principle-*` bodies, `playbook-*` bodies and this
file all hold to that.

The standard is stricter than this. It restricts every word to its approved
dictionary sense and one part of speech, which is checkable only against the
~900-word dictionary this project does not carry. What carries is the part that
survives without it: consistency within a document.

## Prefer the plain word (STE 1.x)

**Test: is the longer word clearer?**

Use, not utilize. Next, not subsequent. If, not in the event that. Buy, not
purchase.

The words that sound bigger than the fact: crucial, delve, enduring, enhance,
garner, interplay, intricate, landscape, pivotal, showcase, tapestry,
testament, underscore, vibrant.

The words that sound technical and mean nothing here: substrate, wedge, vector,
locus, vantage, nexus, harness, bedrock, scaffolding, modality, paradigm,
gold-plating, ratchet, endgame, north star, flywheel.

Substrate becomes base. Wedge in becomes add. Gold-plating becomes more than the
job needs. Endgame becomes the last phase.

`tools.spectre.prose` reports `marketing-adjective` as hard for the small set that
claims quality without showing it: seamless, robust, cutting-edge, effortless,
blazing-fast, world-class, state-of-the-art, game-changing, best-in-class.

## The verb, not the noun (STE 3.7)

**Test: is an action frozen into a noun?**

Bad: `It performs an analysis of the log.`
Good: `The tool analyzes the log.`

Bad: `The wrapper provides assistance to the caller.`
Good: `The wrapper helps the caller.`

Also: fancy ways to say is. `Serves as`, `stands as`, `boasts` and `features`
are `is` and `has` wearing a costume. Just write `is`.

`tools.spectre.prose` reports `nominalization` as hard, and catches the frozen-action
shape. It cannot catch `serves as`, which is a person reading it.

## No phrasal verbs (STE 9.3)

**Test: does the meaning come from the parts, or from the combination?**

Bad: `Spin up the job.` Good: `Start the job.`
Bad: `Hand off the change.` Good: `Give the change to the reviewer.`
Bad: `Rule out the config.` Good: `Ignore the config.`
Bad: `Circle back to the diff.` Good: `Read the diff again.`

The standard's reason is that the meaning is not predictable from the parts, and
both non-native readers and translation systems mishandle it. A model reading
`hand off` is in the same position as a reader who does not know the idiom.

Measured on this set before adoption: 10 occurrences across 79 files.

## Cap a noun cluster at three words (STE 2.1, not implemented)

**Test: how many nouns are stacked on each other?**

`fuel pump valve` is three and fine. `high pressure fuel pump inlet valve
assembly` is six and unreadable.

`tools.spectre.prose` does not check this one, and the header says why: it needs
part-of-speech tagging, and a regex false-positives on every hyphenated
compound. It is a judgement. Count the stack.

Three is a ceiling, not a target. The rule says when a cluster is too long. It
does not say to pull a legal two-word phrase apart into an `of`-chain, which
makes the text heavier than the source was. `the database query times` is three
words and shorter than `the times of the database queries`.

## Define a domain term once (STE 1.5 to 1.13)

**Test: is this term common English, and is it defined where it first appears?**

A technical noun is fine. An undefined one is not. `ripwire`, `evalmirror`,
`advisory-free` and `notALeaf` each get one sentence where they first appear and
are plain afterwards.

This is the standard's own terminology allowance: a project defines its own
approved technical nouns and verbs beyond the base dictionary. That allowance is
real STE, and it is the escape hatch that makes the rest of the standard usable.

## Conserve a word for one part of speech (STE 1.2)

**Test: am I using this word as a noun and a verb in the same document?**

`Apply oil to the valve` with oil as a noun. Not `Oil the valve`, unless the
document declared oil a verb. Prefer the form that reads unambiguously.

## Say what it does, not how it feels

**Test: could this sentence appear unchanged in another project's docs?**

If yes, it says nothing about this one.

`The database stays close at hand`, `SQL you can read`, `types that follow your
schema` name a feeling. The fix names the mechanism or a number:
``.toSQL()`` returns the exact string sent to the database. A column rename fails
the build.

Then ask what the sentence tells the reader to do or know. If you cannot restate
it as a concrete instruction, a fact, or a number, cut it. This is the sharpest
check in the file, and it is mechanical.

## The rest of the residue

These are not STE rules. The standard has nothing to say about them, and they
earn their place by costing a decode.

**Not just X, but Y** Delete `not just` and read what is left. The
clause after `but` is the point, and the setup makes one claim feel like two.

**Rule of three** Count the items. Forcing two real points into
three is a shape the writer wanted rather than a number the content has.

**False ranges** Do both ends sit on one scale? `from 200ms to 3
seconds` is a scale. `from types to docs, from tests to release` is not, so list
the things.

**Boldface and inline headers** Read the paragraph with the
bold removed. If it still reads, the bold is decoration. A bold lead-in that
names the item and is followed by genuinely new detail is fine: **Schema in
TypeScript.** Tables live in one file.

**Generic conclusions** Could this sentence be in any document?
State the specific plan or the fact, or end without a conclusion.

**Mannered prose** Aphorisms, rhetorical fragments for effect,
personified code (`the plan holds it`), figurative verbs (`rides along`). Say
what you mean.

## Vague attributions belong to evidence

`Experts believe`, `industry reports suggest`, `it is widely known`: either name
who, or delete. This is not a word-choice rule but a truth rule, so
`principle-evidence` owns it and holds this for technical claims.

## One topic per paragraph, at most six sentences (STE 6.4 to 6.6)

**Test: can you name the paragraph's topic in three words?**

If the paragraph needs a colon, or an "also", it has two topics. Split it.

The six-sentence cap is the standard's, written for a technician who reads one
page and moves on. It holds here for prose, and it does not hold for a table, a
code block, or a bulleted list, which are structure rather than sentences.

## Vary the construction (STE 6.5)

**Test: does the same sentence opener appear more than twice in a row?**

A page of identical frames is a rule violation, not a neutral style choice. It is
what makes a machine rewrite unreadable. Check for one opener repeated in a row,
for sentences at the same length, and for every paragraph built as subject plus
`must` plus verb.

Fix it by mixing. A conditional sentence. A vertical list. An imperative where
the passage is really a procedure. One short sentence after two long ones.

## Lists for sequences (STE 4.3, 8.4)

**Test: is this a sequence, a condition set, or an enumeration?**

If it is, it is a list. Three or more ordered steps, four or more unordered
items, or any set of conditions the reader has to hold while acting.

```markdown
1. Open `src/auth.ts`
2. Replace `verifyToken` (lines 42 to 58)
3. Run `bun test test/auth`
```

The standard's punctuation rules for a vertical list: colon before it, one
marker style throughout, each item starting with a capital, a period at the end
of a full-sentence item and always at the end of the last one, no period on a
fragment, and no comma or semicolon at a line end. All items at the same
grammatical level, and never a procedural item mixed with a descriptive one.

That last one is the rule worth keeping: a list that mixes what to do with what
is true forces the reader to hold two modes at once.

## Connect with plain words (STE 4.4)

**Test: does the connection between two sentences have a word in it?**

`and`, `but`, `then`, `thus`, `as a result`. Do not rely on adjacency plus tone.
Two sentences next to each other with no connective read as a sequence, whether
or not that is what you meant.

## Headings say what is under them (STE 8.6)

**Test: does the heading alone tell the reader whether this is the section they
want?**

A heading that says `Overview` says nothing. `How the merge gate decides`
tells a reader to stop reading.

This is not a STE rule in this form. The standard writes headings for a printed
page where a reader scans the running head. A markdown heading is a link target
and a grep hit, so it has to carry the nouns a reader would search for.

## Hyphens join words that work as one unit (STE 2.2, 8.2)

**Test: do these two words mean one thing?**

`well-known`, `file-level`, `read-only` are one word each and take a hyphen.
`the file level` is two words and takes a space.

If an approved term is unavoidably longer than three words, write it in full at
first use, then either hyphenate the words that function as one unit or give it a
short form and use that consistently after.

## Cap what a reader sees at a time

**Test: more than five visible items in one group?**

Rank by relevance and group the rest. Show them when they are the next items, or
when the reader asks.

This shapes presentation only. It must not limit analysis, search, tool results,
candidate generation, or anything retained. The cap is on what is on screen, not
on what you know.

The standard has no word-count rule for lists, so this one is local and stays.

## A table cell is a phrase

**Test: does the cell need a comma and a clause to make sense?**

Then it is prose, and it belongs under the table.
