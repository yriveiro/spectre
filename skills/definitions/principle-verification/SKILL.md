# Principle: Verification

Verification is honesty made checkable. In software the only claim worth anything
is a checked one, and a project whose code, manifests, generated artifacts, and
documentation agree with each other, reproducibly, with a command, has earned the
reader's trust. A project where they disagree has not: every statement in it is a
hypothesis, and the reader pays to re-derive what the author already knew. The
amateur asserts and the craft verifies, and the distance between them is not talent
or volume. It is whether the artifact is true.

## The moves

Each of these is one move. Stating one twice at two altitudes is how a principle
grows a body it does not need.

**Run the check, then make the claim.** A report is a receipt, not an intention.
When the check cannot be run, say so plainly instead of implying it passed. Name
what was checked and name what was not: "I did not verify this" is a complete and
useful sentence.

**Prefer the boring true state over the tidy false one.** A project that looks
tidy but cannot be verified is worse than a messy one, because it spends the
reader's trust. Silencing a check, widening an ignore, loosening a constraint to
make something resolve: each makes the project *look* healthy while removing the
ability to know. A check that passes because it was adjusted is worse than one that
fails, because it reports a health that does not exist.

**One claim, one source, and move every copy together.** Any fact stated twice will
drift. A supported-version floor, a dependency pin, a documented requirement, an
inventory in a readme: when one of those moves, every place it is written moves in
the same change. Then search the whole tree for the superseded value and confirm it
is gone:

```sh
grep -R '<old-value>' . | grep -v '<generated-or-vendored>'   # expect no hits
```

The command differs per toolchain. The assertion does not.

**Prove coherence rather than assume it.** After changing a dependency, confirm
that everything which must agree with it actually did: the direct pin, the lockfile
or its equivalent, and any transitive copy. One search is cheaper than the whole
class of bug where two versions of the same thing coexist and quietly disagree.

**What is true is what the tool says now.** Recall is a hypothesis and a diff is
evidence. Read the file rather than reporting what it should contain. To learn what
a version range changed, diff the range. Commit subjects, release notes, changelog
prose, and ancestry heuristics are each independently misleading, and when the tool
that gives the truth is available, a cheaper signal is a worse one.

**Reproduce before diagnosing.** Explaining a failure you have not reproduced is
guessing. Reproduce it somewhere that cannot damage the real thing.

**Audit your own claims first.** The claims you are most confident about are the
ones you checked least. Re-verify work you have already finished before reporting
it, because the residue is where the mistakes live.

**Establish what a change touched before deciding what it means.** A diff's blast
radius is a fact to establish, not an inference to make.

**Account for every line of a regenerated artifact.** A refreshed lockfile, a
rebuilt bundle, a regenerated client: each is a diff nobody authored and everybody
must still stand behind. Every added subtree needs a provenance that can be named.
"It just came along" is the symptom of an unreviewed change.

**Keep the command next to the claim.** A number in a report, a green checkmark, a
passing build: each promises that a stranger can run the same command and get the
same result.

**Run the project's own checks, not your idea of them.** A repository that
documents how to verify itself has told you what verification means here. Prefer
its commands over a generic substitute you invented, and add to them when a real
gap appears.

**Check the working tree before declaring done.** Status and diff are the last two
commands of a task, not the first two of the next one. Never report state you did
not produce.

**Write for the reader who will believe you without checking.** Prose held by a
stranger is held to a higher standard than a commit message, because a stranger
cannot reconstruct your reasoning. Make sure they were right to.

## What this principle is not

- **Not a proxy for correctness.** A passing check proves the thing it checks.
  Confirm you ran the check that covers the claim, not the nearest one that was
  easier to reach.

