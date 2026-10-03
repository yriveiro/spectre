# grammar-words

One word, one meaning, the plainest one available. Load it when you choose a
word, name something, or notice the same thing going by several names.

The first half is ASD-STE100 Issue 9. The second half is residue: the standard
governs maintenance prose and is silent on the words developer prose leans on,
so the tells it does not cover are here under their original `unslop` numbers.

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

## Prefer the plain word (STE 1.x, and `unslop` 31)

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

`lint/prose.ts` reports `marketing-adjective` as hard for the small set that
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

`lint/prose.ts` reports `nominalization` as hard, and catches the frozen-action
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

`lint/prose.ts` does not check this one, and the header says why: it needs
part-of-speech tagging, and a regex false-positives on every hyphenated
compound. It is a judgement. Count the stack.

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

## Say what it does, not how it feels (`unslop` 27)

**Test: could this sentence appear unchanged in another project's docs?**

If yes, it says nothing about this one.

`The database stays close at hand`, `SQL you can read`, `types that follow your
schema` name a feeling. The fix names the mechanism or a number:
``.toSQL()`` returns the exact string sent to the database. A column rename fails
the build.

Then ask what the sentence tells the reader to do or know. If you cannot restate
it as a concrete instruction, a fact, or a number, cut it. This is the sharpest
check in the file, and it is mechanical.

## The rest of the residue (`unslop` 9, 10, 12, 15, 16, 25, 32)

These are not STE rules. The standard has nothing to say about them, and they
earn their place by costing a decode.

**Not just X, but Y** (`unslop` 9). Delete `not just` and read what is left. The
clause after `but` is the point, and the setup makes one claim feel like two.

**Rule of three** (`unslop` 10). Count the items. Forcing two real points into
three is a shape the writer wanted rather than a number the content has.

**False ranges** (`unslop` 12). Do both ends sit on one scale? `from 200ms to 3
seconds` is a scale. `from types to docs, from tests to release` is not, so list
the things.

**Boldface and inline headers** (`unslop` 15, 16). Read the paragraph with the
bold removed. If it still reads, the bold is decoration. A bold lead-in that
names the item and is followed by genuinely new detail is fine: **Schema in
TypeScript.** Tables live in one file.

**Generic conclusions** (`unslop` 25). Could this sentence be in any document?
State the specific plan or the fact, or end without a conclusion.

**Mannered prose** (`unslop` 32). Aphorisms, rhetorical fragments for effect,
personified code (`the plan holds it`), figurative verbs (`rides along`). Say
what you mean.

## Vague attributions moved out (`unslop` 5)

`Experts believe`, `industry reports suggest`, `it is widely known`: either name
who, or delete. This is not a word-choice rule, it is a truth rule, and
`principle-evidence` owns it. It holds this rule for technical claims.