# grammar-text

The shape of a document: what a reader sees before they read a word. Load it
when you write a file a person has to navigate, not just a message they read
once.

ASD-STE100 Issue 9 covers this ground for maintenance documentation. Its rules
are about a printed manual with a fixed page order. A markdown file that a model
greps is a different reader, so each rule below carries a note about which
reader it was written for.

## One topic per paragraph, at most six sentences (STE 6.4 to 6.6)

**Test: can you name the paragraph's topic in three words?**

If the paragraph needs a colon, or an "also", it has two topics. Split it.

The six-sentence cap is the standard's, written for a technician who reads one
page and moves on. It holds here for prose, and it does not hold for a table, a
code block, or a bulleted list, which are structure rather than sentences.

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

## Cap what a reader sees at a time (`i-have-adhd` 9, kept)

**Test: more than five visible items in one group?**

Rank by relevance and group the rest. Show them when they are the next items, or
when the reader asks.

This shapes presentation only. It must not limit analysis, search, tool results,
candidate generation, or anything retained. The cap is on what is on screen, not
on what you know.

The standard has no word-count rule for lists, so this one is local and stays.

## A table cell is a phrase (`i-have-adhd` pre-send, kept)

**Test: does the cell need a comma and a clause to make sense?**

Then it is prose, and it belongs under the table.

## What this leaf has no instrument for

Everything here is a person reading the page. `ripwire/SKILL.md` records that as
`none`, and the floor is that the reader decides whether the shape worked.

The three rules that are mechanically checkable live in the other two leaves,
because they are word and sentence rules: `grammar-sentence` for the semicolon
and the length, `grammar-words` for the phrasal verbs.