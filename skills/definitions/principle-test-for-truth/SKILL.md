# Principle: Test For Truth

Which tests a project keeps is a decision about defects and cost, and every failure
it finds gets triaged rather than tolerated. `principle-evidence` already owns
whether a check can fail at all. `principle-verification` already owns the rule about
adjusting a check. `principle-test-behavior-not-implementation` already owns the
shape of one assertion. This leaf owns what sits around them: which tests the project
owns, what each one catches, and what it costs.

Most scenarios are writable and few are reachable, so effort against return decides
which ones you keep. The floor is that you pursue truth rather than a green board,
and the floor outranks every move below it.

## The moves

**Name the defect before you write the test.** Say it in the world rather than in
the code: "the refund lands twice", not "the second branch is wrong". A test whose
defect you cannot name is coverage you pay CI time for and nobody reads.

**Break the code on purpose and watch the suite go red.** Flip one condition, drop
one branch, return a constant, then run the tests. A suite that stays green owns
nothing on that line. `principle-evidence` owns the act and asks it of every new
check. What this leaf adds is the whole-file version, where a tool injects every
mutation it can reach and reports the ones no test caught. Read that report only
after the tool shows you that it launched your tests. One that launched none reports
nothing caught, and nothing caught reads like a clean sheet.

**Inject the fault a mutation cannot reach.** A clock that jumps, a socket that
dies mid-write, a disk that fills, a dependency that answers 200 with an empty
body. `principle-prove-it-works` owns walking the failure path before you say done.
This is the other half: the fault stays behind in the suite as a test. A mutant is
a wrong answer. A fault is a wrong world.

**Hold the golden path harder than every other path.** Ordinary input, taken the
ordinary way, by every caller, every time. It gets the most assertions and the
fewest excuses, because its failure is the one a user sees.

**Sort each scenario by how it can happen, then cut the tail.** Every scenario is
writable and few are reachable. "Only if two unrelated things fail on the same run"
is a comment rather than a test. Rank the rest by what the defect costs against the
hours the test spends on every future run, and let that arithmetic cut the list.

**Never manufacture green.** Do not skip the test, widen the tolerance, add a
retry, or loosen an assertion to get a passing run. Do not mock the failure away or
delete the case either. `principle-verification` owns the rule and `tdd` owns the
order. This leaf owns the list of suite-level moves. When the expectation is wrong
about the product, change it on purpose. The new value is the behaviour somebody
agreed on, and it lands in the same commit as the reason. Nothing above this line
overrides it.

**Triage a red in this order: fix it, then live with it, then delete it.** Decide
first whether you care, because a red nobody triaged is a red nobody reads. Then ask
whether you can fix it. When you cannot, the floor above decides what you may do,
and the answer is never a green that lies. The suite reports itself as incomplete
for that check, naming the defect, an owner and a date when it comes back. Skipping
the test, annotating the skip, and changing the expectation to the wrong value are
the three moves that floor forbids. If none of the three applies, the test goes.

**Keep the regression test for every bug that reached a person.** The bug fix
procedure writes one, and keeping it belongs here. Put the defect back and confirm
the test still fails, because a regression test that stopped watching is a comment
that costs a run.

**Write an API's promises as a `.feature` file, then run it.** A Gherkin file says
what the API guarantees in the words a caller uses. A runner generates the test from
that file, so the specification and the check are one artefact. Use it where a
promise crosses to a stranger. A private function has no caller to write the
feature for.

**Set a performance test only where volume or latency decides the design.** State
the input size and the ceiling, then assert both: this many rows finish under this
many milliseconds. A dataset large enough to change the answer, or a latency written
into a contract, earns that test. Everywhere else a reasonable figure for processor
time and memory needs no threshold. A benchmark with no ceiling measures the
machine rather than the code.

**Keep one smoke test and run it first.** From a clean state, through the real
surface, it answers one question: is the thing alive. It stays cheap as the suite
grows, and a pipeline without one hears about a broken build from a bug report.

## What this principle is not

- **Not a coverage target.** The question is which defect each test catches. A
  percentage cannot answer that.
- **Not a licence for a large suite.** Every test you keep is one that the next
  change must still run and somebody must still read.
- **Not a `.feature` file that narrates a unit test.** Gherkin earns its cost at a
  promise a stranger depends on. A file that restates a function's own cases is
  ceremony over an assertion.
- **Not "never change a test to make it pass".** An expectation that is wrong about
  the product is a decision to change, and the commit carries the reason. The
  forgery is the edit that makes the suite agree with a defect nobody accepted.
