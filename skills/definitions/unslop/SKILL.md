# unslop

Edit text to remove the tells that make a reader stop trusting the writer. The
tells are not style preferences. Each one is a place where the sentence costs the
reader a decode it should not have cost, and every rule here has a check that
either passes or does not.

Two rules carry most of the weight. **27**: if the sentence could appear unchanged
in another project's docs, it says nothing about this one, so cut it. And **13**:
a dash hides a missing full stop. Between them they catch more than the rest put
together, and both are mechanical.

Rule numbers are stable ids, so other skills cite them. The
gaps are deliberate: 17, 18 and 19 (title case, emoji, curly quotes) are a
formatter's job rather than a rule, and 20 and 22 duplicate what
`i-have-adhd` rule 10 owns, which is the shape of a message rather than the words
in it.

## The rules

**3. Superficial -ing phrases.** Test: grep for -ing at the end of a clause.
"Highlighting", "ensuring", "reflecting", "showcasing", "fostering", "leveraging".
They stand in for a fact nobody wrote. Delete the phrase, or finish the sentence
with the thing it gestured at. The dangling form is the same tell at longer
length: "The change, ensuring backward compatibility, touches two files."
Bad: "This ensures the token is refreshed." Good: "This refreshes the token."

**5. Vague attributions.** Test: whose is the attribution? "Experts believe",
"industry reports suggest", "some critics argue", "it is widely known", "best
practice is". Either name who, or delete. An attribution with no name gives the
reader nothing and hides the fact that nobody said it. If the claim matters it can
be checked, so it can carry a citation. If it does not matter, it is not there.
`principle-evidence` holds this rule for technical claims.

**7 and 26. Words that sound bigger than the fact.** Test: is there a plainer word
that says the same thing? The inflated ones: crucial, delve, enduring, enhance,
garner, interplay, intricate, landscape, pivotal, showcase, tapestry, testament,
underscore, vibrant. The ones that sound technical and mean nothing: substrate,
wedge, vector, locus, vantage, nexus, harness, bedrock, scaffolding, modality,
paradigm, gold-plating, ratchet, endgame, north star, flywheel. "Substrate"
becomes "base". "Wedge in" becomes "add". "Gold-plating" becomes "more than the
job needs". "Endgame" becomes "the last phase".

**8. Fancy ways to say "is".** Test: read the verb. "Serves as", "stands as",
"boasts", "features" are a way of writing "is" or "has". Just write "is".

**9. "Not just X, but Y."** Test: delete "not just" and read what is left. The
clause that follows the "but" is the point, and the setup is a way of making one
claim feel like two.

**10. Rule of three.** Test: count the items in the list. Forcing two real points
into three, or four real points into three, is a shape the writer wanted rather
than a number the content has. Use the natural count.

**11. Synonym cycling.** Test: does the paragraph use two words for one thing?
Protagonist, main character, central figure, hero in one paragraph is four words
the reader has to map onto one referent. Pick one and repeat it.

**12. False ranges.** Test: do both ends sit on one scale? "from 200ms to 3
seconds" is a scale. "from types to docs, from tests to release" is not. List the
things. Bad: "I swept the change from types to tests to release notes." Good: "I
swept three places: the types, the tests, and the release notes."

**13. No em dashes.** Test: grep for a dash. A period or a comma goes there, and
not an en dash or a hyphen as a stand-in either. A dash hides a missing full
stop, and two thoughts joined by one are two sentences that were never split. A
dash inside a code block, a commit message, a quoted flag, or a file name is not
prose, so leave it. This file holds one em dash and it is the bad example below.
Bad: "the fix is a one-line change — and it touches two files." Good: "The fix is
a one-line change. It touches two files."

**14. Colon overuse.** Test: is the colon before a list or an example? Those are
fine. A colon mid-sentence as a connector adds nothing and reads as a crutch. "If
you're coming from traditional automation: instead of registering event handlers,
you describe conditions" becomes "Describing when the scheduler should fire works
best as plain English."

**15. Boldface overuse.** Test: read the paragraph with the bold removed. If it
still reads, the bold is decoration.

**16. Inline-header lists.** Test: does the bold label restate the line after it?
"**Performance:** Performance improved" is a tell. Convert it to prose. A bold
lead-in that ends in a period, names the item, and is followed by genuinely new
detail is fine: "**Schema in TypeScript.** Tables live in one file."

**23. Filler phrases.** Test: search for the phrase. "In order to" becomes "To".
"Due to the fact that" becomes "Because". "It is important to note that" gets
deleted.

**24. Excessive hedging.** Test: how many qualifiers does the sentence carry?
"could potentially possibly be argued that it might" becomes "may". A hedge that
carries real uncertainty is content, and `i-have-adhd` rule 11 owns the difference
between hedging and admitting a gap.

**25. Generic conclusions.** Test: could this sentence be in any document? "The
future looks bright" says nothing about this one. State the specific plan or the
specific fact, or end without a conclusion.

**27. Say what it does, not how it feels.** Test: could this sentence appear
unchanged in another project's docs? If yes, it says nothing about this one, so
cut it. "The database stays close at hand", "SQL you can read", "types that follow
your schema" all name a feeling. The fix names the mechanism or a number: "`.toSQL()`
returns the exact string sent to the database", "a column rename fails the build".
Then ask what the sentence tells the reader to do or know. If you cannot restate
it as a concrete instruction, fact, or number, cut it. This is the sharpest check
in the file and it is mechanical.

**28. Shorten or split dense sentences.** Test: does it land in one pass? If the
reader has to backtrack to parse a sentence, break it in two or drop a clause. One
idea per sentence. A clear thirty-word sentence is fine and a dense twelve-word
sentence is not, so judge by the landing and not by the count.

**29. Active voice.** Test: search for "is", "are", "was", or "were" plus a past
participle, and ask who is doing it. "queries are validated" becomes "the compiler
validates queries". "the file is parsed by the loader" becomes "the loader parses
it". Passive is fine when the actor is unknown or genuinely does not matter.

**30. Cut the adverb, or use a stronger verb.** Test: which verb would this adverb
be doing? "runs quickly" becomes "is fast" or a number. "significantly improves"
becomes the measured delta. An adverb propping up a weak verb means the verb is
wrong. Bad: "The wrapper correctly handles the empty array." Good: "The wrapper
returns an empty array."

**31. Prefer the plain word.** Test: is the longer word clearer? Use, not utilize.
Next, not subsequent. If, not in the event that. Buy, not purchase. Facilitate
becomes help, numerous becomes many. The fancier synonym is rarely clearer.

**32. Mannered prose.** Test: is there a literal phrase that says the same thing?
Aphorisms ("wire it or delete it"), rhetorical fragments for effect, personified
code ("the plan holds it"), figurative verbs ("rides along", "stands on"), and
stock framing phrases. Say what you mean.

**33. Over-compression.** Test: can you add the article and the verb back? Dropped
articles, verbless fragments, symbol-speak, and abbreviations all spend the budget
the work needs. Bad: "Parser rejects bad date → exit 2, no write." Good: "The
parser rejects a bad date, exits with code 2, and writes nothing."

## When the rules conflict

Rule 27 and rule 11 pull against each other: 27 cuts a sentence that could be
generic, and 11 removes four words for one referent. Both are cuts, so when they
collide, keep the specificity and cut the flourish rather than the other way round.

A rule loses to the task. If a sentence has to be that long to be true, it is that
long. Terse is the goal and cryptic is the failure, and rule 28 is the brake on
overshooting the goal.
