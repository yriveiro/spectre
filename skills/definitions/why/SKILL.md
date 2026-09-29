# Why

Recover the reason a piece of code has the shape it has.

`how` answers what the code does. This answers what forced that. The difference
matters because the two need different evidence: the tree is complete for the
first and silent on the second.

The only source here is git. There is no ticket tracker, no chat, no incident
service, and a local clone has no pull request bodies. Everything below is what
git can answer, and a fair amount of what people ask is not in it.

## Start

Anchor the target before asking anything. You need a path, and usually a line.

```
const h = await tools.spectre.history({ path: "src/auth/session.ts", line: 88 })
h.bodies         // 0 means git holds no rationale for this file
h.commits        // newest first, subject and body
h.blame          // who last touched line 88, and what they said
```

If `bodies` is 0, the file has subjects and no rationales. Keep going, because
the diff may still answer it, but lower what you expect to find. `introducedBy`
is the commit that created the file, and it is the highest-value row: it says what
the shape was for before later commits bent it.

## Phase A: Ask the diff, not the message

A line nobody wrote a message about has no `contains` answer, because the reason
was never typed. Its origin is still in the diff:

```
const origin = await tools.spectre.history({ path: "src/auth/session.ts", matches: "rotateRefresh" })
```

`matches` is the pickaxe: the commits that added or removed that exact text. It
returns additions and deletions both, so a text that was added and later removed
gives you two commits, and that is usually the whole story of the shape.

Use `contains` for the commits that argued — "fix", "revert", "keep", "for now",
"temporary" — and `matches` for the code nobody explained. They are different
questions and neither substitutes for the other.

## Phase B: Read the rest of the repository

Git is not the only thing in the tree. Three more places carry rationale, and
they cost one command each:

- **Tests.** A test named `handles_clock_skew` tells you the edge case that
  motivated the branch above it, and that reason exists nowhere else.
  `ripwire.for` with the symbol name finds them.
- **In-repo records.** `docs/adr/`, `docs/decisions/`, a `NOTES.md`. Search for
  them; a repository that keeps them has usually kept them for years.
- **TODO and FIXME near the target.** A `// FIXME: the retry is wrong when the
  clock skews` is the reason the retry looks like it does. It is also a
  confession that nobody knows, and both facts matter.

## Phase C: Read the shape of the evidence

This is the phase that decides the answer. For each commit you are about to
believe, sort it:

- **Direct.** The message says the thing you are asking about. A body reading
  "we tried a single rotating key and concurrent refreshes invalidated each
  other" is a direct answer to why the code is this shape.
- **Circumstantial.** The commit touched the file and its date lines up with
  something you know. It suggests; it does not establish.
- **Not evidence.** The code itself. A function named `isExpired` is not a reason
  for the expiry check to exist. You are about to argue from a name, and a name
  is a label somebody wrote earlier, with no more authority than the code.

Say which one each is. A conclusion built on circumstantial evidence is
perfectly reasonable, as long as the reader knows that is what it is.

## Phase D: Expect nothing

The likely answer is that git does not say, and that is a real answer. Say it
plainly: *nobody recorded a reason; the shape is from a commit whose message is
"small refactor"; here is the date and here is the author, ask them.* That is
more useful than an inference dressed as a finding, and it is the outcome this
procedure exists to reach.

Four ways the history lies, and what to do about each:

- **Squash merges.** A squashed branch loses every commit but one. The single
  surviving message may be the PR title, which is a title and not a reason.
- **A message that understates.** "Small refactor" sometimes hides a behaviour
  change. `git show <sha>` and read the diff; the diff is the truth about what
  changed, and the message is a claim about it.
- **A copied pattern.** Nobody chose this shape on purpose; it was copied from
  the next module over. If the pickaxe returns a commit that also touched a
  sibling file, that is the likely origin, and the reason may be the sibling's.
- **A bot.** Dependabot and Renovate commits carry no intent. Skip them; they
  are noise in a rationale count.

## Phase E: Decide what to do with the answer

An answer changes what you may do next, and the three outcomes are different:

- **A recorded constraint.** Honour it. The guard against an impossible condition
  is guarding against something that happened to somebody, and removing it is
  removing the only trace of that.
- **A reason that no longer holds.** Say so, with the commit and the date. This
  is the valuable case: the code is a fossil, and naming the fossil is what lets
  it be removed without argument.
- **No reason recorded.** Then the code is not load-bearing on a constraint you
  can see, and you are free to simplify it. Say that it had no recorded reason
  rather than inventing one, because a fabricated rationale is the one artefact
  that will still be wrong in six months.

## Outputs

A short read, not a transcript. Three parts, in this order:

1. **The reason**, in a sentence or two, with the commit and the date. Mark it
   direct or circumstantial.
2. **The gap**, if there is one. What the history does not contain, so the reader
   knows the limits of the answer.
3. **What it means for the change at hand**, in one line. This is the part that
   saves the reader redoing the archaeology.
