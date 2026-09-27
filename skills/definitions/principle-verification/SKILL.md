# Principle: Verification

## What this principle is

Verification is honesty made checkable.

In software, the only claim worth anything is a checked one. A project whose
code, manifests, generated artifacts, and documentation all say the same thing —
and whose agreement you can reproduce with a command — has earned the reader's
trust. A project where they disagree has not: every statement in it is a
hypothesis, and the reader pays to re-derive what the author already knew.

This is the line between amateur work and craft. The amateur asserts; the craft
verifies. The distance between them is not talent, volume, or ambition. It is
whether the artifact is *true*.

This principle is not formatting, and it is not owning a linter. It is the
discipline of never asserting more than has been checked.

## Core values

**Truth over appearance.** A project that looks tidy but cannot be verified is
worse than a messy one, because it spends the reader's trust. Choose the boring
true state.

**One claim, one source.** Any fact stated twice will drift. A fact that must
appear in several places — a supported-version floor, a dependency pin, a
documented requirement, an inventory in a readme — moves together, in one
change. Never update one copy and leave the others. Once a fact is repeated, every
extra copy becomes a liability to re-check whenever the original moves.

**The diff, not the memory.** What is true is what the tool says now. Recall is
a hypothesis; a diff is evidence. Never report what a file *should* contain — read
what it contains.

**Unverified is not a claim.** If it was not checked, it is not a fact. Write
what was checked, and name plainly what was not. "I did not verify this" is a
complete and useful sentence.

## Strategies

How the values are applied at the level of judgement:

**Verify before reporting.** Run the check, then make the claim. A report is a
receipt, not an intention. When the check cannot be run, say so plainly instead of
implying it passed.

**Reproduce before diagnosing.** Explaining a failure you have not reproduced is
guessing. Reproduce it somewhere that cannot damage the real thing.

**Diff to establish what changed.** To learn what a version range changed, diff
the range. Do not infer it from commit subjects, release notes, changelog prose,
or ancestry heuristics — each is independently misleading, and believing one is how
a wrong conclusion gets filed as a finding. When the tool that would give you the
truth is available, a cheaper signal is a worse one.

**Audit your own claims first.** The claims you are most confident about are the
ones you checked least. Re-verify work you have already "finished" before
reporting it; the residue is where the mistakes live.

**Calibrate to the reader's trust.** Prose written for a stranger is held to a
higher standard than a commit message, because a stranger cannot reconstruct your
reasoning. Write for the reader who will believe you without checking — and make
sure they were right to.

## Tactics

The mechanical habits. These are the details; the values above are why they are
not optional.

**Declare a floor once, then prove nothing is left behind it.** When a supported
version or minimum moves, find every place it is written and move them together.
Then search the whole tree for the superseded value and confirm it is gone. The
command differs per toolchain; the assertion does not.

```sh
# the shape, whatever the toolchain: search for what you just superseded
grep -R '<old-value>' . | grep -v '<generated-or-vendored>'   # expect no hits
```

**Prove coherence rather than assume it.** After changing a dependency, confirm
that everything which must agree with it actually did — the direct pin, the
lockfile or its equivalent, and any transitive copy. One search is cheaper than
the whole class of bug where two versions of the same thing coexist and quietly
disagree.

**Read the file; do not recall the file.** Open it, read it, quote it. Any finding
resting on what a file says must rest on having read that file.

**Separate the change from its blast radius.** First establish what a diff
touches, then decide what that means for the thing in question. In a large diff
this is the only way to stay both honest and fast.

**Check the working tree before declaring done.** Status and diff are the last two
commands of a task, not the first two of the next one. Never report state you did
not produce.

**Account for every line of a regenerated artifact.** A refreshed lockfile, a
rebuilt bundle, a regenerated client: each is a diff nobody authored and everybody
must still stand behind. Every added subtree needs a provenance that can be named.
"It just came along" is the symptom of an unreviewed change.

**Do not ship claims that cannot be reproduced.** A number in a report, a green
checkmark, a passing build — each promises that a stranger can run the same
command and get the same result. Keep the command next to the claim.

**Prefer the boring true state over the tidy false one.** Silencing a check,
widening an ignore, loosening a constraint to make something resolve — these make
the project *look* healthy while removing the ability to know. A check that passes
because it was adjusted is worse than one that fails, because it reports a health
that does not exist.

**Run the project's own checks, not your idea of them.** A repository that
documents how to verify itself has told you what verification means here. Prefer
its commands over a generic substitute you invented, and add to them when a real
gap appears.

## What this principle is not

Guards against the failure mode of every principle, which is becoming a ritual
performed for its own sake.

- **Not a gate.** A verification nobody runs proves nothing. A checklist nobody
  executes is decoration.
- **Not a proxy for correctness.** A passing check proves the thing it checks.
  Confirm you ran the check that covers the claim, not the nearest one that was
  easier to reach.
- **Not gatekeeping.** The target is work that is true, not authors who are caught
  out. Apply it to your own output first, and most often.
