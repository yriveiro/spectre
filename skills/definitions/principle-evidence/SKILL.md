# Principle: Evidence

## What this principle is

Evidence is the discipline of obtaining the proof, not merely of claiming it.

`principle-verification` says a fact nobody checked is not a fact. This is the
other half of that: how the check is actually obtained, and how you know the check
itself works. Two failures live here, and both are silent.

The first is **an opinion where a measurement belongs.** Two implementations are
both defensible, the reasoning on both sides is sound, and the argument settles
nothing — because nobody built the thing that would settle it. A second
implementation of the same specification, a compiler, a tokenizer, the upstream
tool, a corpus of real input: each is an oracle, and any of them converts an
argument into a number. The reasoning was never the bottleneck.

The second is **a check that cannot fail.** A suite that is green because it
asserts nothing is indistinguishable, from the outside, from a suite that is green
because the code is right. Nobody has been lied to; the report has simply stopped
carrying information. The only way to tell the two apart is to break the thing on
purpose and watch the suite go red.

Neither failure announces itself. The first feels like rigour. The second feels
like safety. Both ship.

This principle is not a gate, and it is not a demand for measurement everywhere.
Some questions are settled by reading the file. What it rules out is the specific
substitution of *sounding right* for *having checked*, in either direction: the
unmeasured claim, and the unfalsifiable check.

## Core values

**An oracle beats an argument.** When two things are both plausible, build the
thing that knows the answer — a reference implementation, a parser, a schema, a
query — and ask it. Reasoning about which is better is cheap and frequently
wrong; the oracle is usually already installed and takes one command.

**A check that cannot fail is decoration.** Every assertion you can break on
purpose is worth writing, and a suite you have never seen fail tells the reader
nothing about whether it works. Break it, watch it go red, put it back.

**Measure the population, not the specimen.** A number from three hand-picked
cases is an anecdote with a decimal point. The claim "this is faster", "this is
more accurate", "this is safe" has a population behind it — every file of a kind,
every call of a shape, the whole corpus — and the number means only as much as
that population does.

**Before and after, same population.** A comparison is only a comparison when both
sides ran against the same inputs with the same method. Changing the corpus
between runs converts a measurement into a story.

**Report the misses too.** An accuracy number with no false-positive count is a
number chosen to flatter. A recall figure alone is how a scanner that returns every
line in the file scores 100%.

## Strategies

**Find the oracle before forming the opinion.** The cheapest question to ask when
two designs are in balance is: what would I have to measure to know? Often the
answer names a tool that is already on the machine. If no oracle exists, writing a
small one is usually faster than the argument it replaces.

**Falsify before you trust.** When a check is new — a test suite, a linter rule, a
benchmark, a scanner — deliberately break the thing it inspects and confirm it
notices. A check that has never failed has not been shown to work. This is the step
people skip, and skipping it is how a suite full of assertions that cannot fail
gets reported as a passing gate.

**Score both sides of a rewrite.** Keep the old implementation runnable, run both
over the same corpus, and read the diff in both directions: what the new one finds
that the old missed, and what the old found that the new misses. Both lists are
findings. The second one is the one that gets skipped, and it is where the
regressions live.

**Let the disagreement be visible.** When a measurement contradicts the obvious
answer, that is the most valuable result of the session. Do not quietly pick the
reading that supports the change already made — go and find out why the number says
otherwise.

**State the population with the number.** "1.00 precision on 58 files" is a claim a
reader can act on. "Perfect precision" is a slogan. The denominator is the claim.

## Tactics

The mechanical habits. These are the details; the values above are why they are not
optional.

**Break one thing on purpose per new check.** If a suite has never been red, it has
not been tested. Remove the behaviour it is supposed to catch, run it, confirm the
failure names the right thing, restore. Ten minutes here buys the confidence to say
"the tests cover it" for the rest of the project's life.

**Count both error directions.** Precision and recall travel together. Report the
false positives next to the true positives, or quote only the direction that
supports the change.

**Diff the two implementations over real input.** For a change to a scanner, a
parser, a matcher, or a formatter, the honest check is a before/after over every
file of the kind it handles, with both diffs printed and each line classified as a
gain or a loss. Sampling tells you the direction; only the full diff tells you the
size.

**Use the reference implementation as the scoreboard.** A language's own tokenizer,
a schema validator, a compiler, a linter's own output: whatever already knows the
answer will score both candidates for free, and its verdict is not your opinion.

**Time it if you changed how it runs.** A change to a hot path is not done until
someone has measured it against the version it replaces, on realistic input, with
the numbers in the report. "It should be faster" is a hypothesis with a cost.

**Keep the harness.** The corpus, the oracle, and the command that produced the
number are worth more than the number. They are what lets the next iteration prove
it is an improvement instead of asserting it.

**Let a red suite be the good outcome.** A mutation that no test catches is a
finding about the tests, and it is the cheapest finding you will get all session.

## What this principle is not

Guards against the failure mode of every principle, which is becoming a ritual
performed for its own sake.

- **Not a demand to measure everything.** Some questions are answered by reading
  the code. Measuring a decision that was never in doubt spends attention the
  doubtful decisions needed.
- **Not a substitute for judgement.** A number narrows the field; it does not pick.
  Two options that score identically still need a reason, and the reason is
  sometimes taste, cost, or what the project is for.
- **Not a licence to ship a number instead of a fix.** A measurement that arrives
  without the change it justifies has produced a fact and no work.
- **Not theatre.** A benchmark nobody runs, a corpus nobody regenerates, an oracle
  cited in a report and not in the repository — these are the failure mode. Evidence
  that cannot be reproduced by the next reader is a claim again.
