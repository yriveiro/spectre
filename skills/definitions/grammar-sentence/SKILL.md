# grammar-sentence

One sentence, one claim, one named actor. Load it when you write a sentence a
person or a model has to parse without asking you what you meant.

These are the sentence rules of ASD-STE100 Issue 9. Where a local rule here
disagreed with the standard, the standard landed and the local rule was deleted.
The deletions are listed at the bottom so the history stays readable.

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

`lint/prose.ts` reports `passive-voice` as advisory, because "is left" is
correct when nothing did the leaving.

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
the claim. `lint/prose.ts` reports `present-perfect` as advisory for this
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

## One instruction per sentence (STE 5.2)

**Test: does the sentence ask for two things?**

`Open the file and read line 3, then check it against the spec` is three
instructions in one sentence. Split it, or make it a numbered list.

This rule replaced `unslop` rule 28, which said to judge a sentence by whether it
lands in one pass. The standard won that disagreement. A reader cannot compute
"lands in one pass", and a rule a reader cannot compute is a rule nobody applies.

## No semicolons (STE 8.1)

**Test: is there a semicolon anywhere?**

STE bans the mark outright. Rule 8.1 permits every other standard punctuation
mark, so the em dash is legal and stays legal here.

Bad: `The agent deletes the file; then it logs the path.`
Good: `The agent deletes the file. Then it logs the path.`

This replaced `unslop` rule 13, which banned the em dash and kept the semicolon.
Inverted, because the standard says so.

Measured on this set before adoption: 168 semicolons in prose across 79 files,
and 0 inside a code fence or a table row. This is the rule that costs the most,
and it is one character per finding.

## Keep the subject, the verb, and the article (STE 4.2, 4.5)

**Test: was a word dropped to make the line shorter?**

Bad: `Files not backed up will be lost.`
Good: `The tool does not back up files. Files that are not backed up are lost.`

This replaced `unslop` rule 33, over-compression. The standard and the local rule
agreed here, so only the numbering moved.

## Keep modality exactly (STE 3.2, and the linter's silence)

**Test: does the rewrite still say what the author was confident about?**

`May have failed` and `failed` are different claims. A hedge is the author's
stated uncertainty, and it is content.

This replaced `unslop` rule 24, which told the writer to count qualifiers and
delete them. The standard does the opposite, and `lint/prose.ts` never flags
`may`, `might` or `could` at all. A linter that pressured hedges out would
rewrite claims into facts.

The line to hold: hedge down to one qualifier, never to zero. "Could potentially
possibly be argued that it might" becomes `may`. "May have failed" stays.

## Deleted by this standard

| Was | Rule | Why |
| --- | ---- | --- |
| `unslop` 13 | no em dashes | STE 8.1 permits the dash and bans the semicolon instead |
| `unslop` 24 | delete hedges | the standard treats confidence as content |
| `unslop` 28 | judge by landing, not count | STE 5.1 and 6.3 give numbers |

The numbers are gaps on purpose, the way `unslop` 17, 18, 19, 20 and 22 were.
Other files still cite rule 28 by number, and those citations now mean this
leaf.