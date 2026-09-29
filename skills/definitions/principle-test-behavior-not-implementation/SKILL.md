# Principle: Test Behavior, Not Implementation

A test calls the code the way its callers do and asserts the result against a
literal value. A test that asserts which calls the code made, or restates a
constant the code already contains, does neither, and it costs CI time and
review attention to do it badly.

The check is one question, and it has a mechanical answer: would this test still
pass if every function it imports returned `undefined`? If yes, it observes no
behavior, so it cannot fail for a defect, and the only edits that make it fail
are edits to the test. A test in that state is worse than no test, because a
green suite that cannot fail for a defect is evidence about nothing, and
`principle-verification` is right to refuse it.

The mutation also explains why a constant pin is a liability rather than a cheap
win. `expect(LIMITS.maxTools).toBe(8)` fails the moment somebody edits the limit,
which is the edit the limit was there to permit. It is not a test of the limit. It
is a test of the fact that the number has not changed, dressed as a test of the
code that reads it.

What to assert instead is one concrete input and one literal expected value, or
one observable effect. What not to do is reach for the code under test to produce
the expected side of the comparison, because that is a tautology with a test
around it.

## The moves

**Run the undefined check before you keep a test.** Replace every import's return
with `undefined` in your head and read the assertions. Anything that still passes
is in one of the five shapes below, and it is either rewritten or deleted. It
takes a minute and it is the only part of this principle that is not a judgement.

**Look for the five shapes.** Each one passes the mutation, and each has a name
you can point at in review:

- **Weak or no assertion.** No `expect`, or only `toBeDefined`, `toBeTruthy`,
  `not.toThrow`, `toBeInstanceOf`, `toBeGreaterThan(0)`. All of them pass on
  `undefined`.
- **Mock or absence only.** Only `toHaveBeenCalled`, `not.toHaveBeenCalled`,
  `toBeUndefined`, `toEqual([])`, `toHaveLength(0)`. The call happened, or
  something was empty, and neither says the code was right.
- **Self-referential.** The expected value comes from the code under test, as in
  `expect(parsed.url).toBe(buildUrl(...))`. Both sides ran the same logic, so the
  comparison cannot fail.
- **Constant pin.** The assertion restates a hand-maintained constant, a config
  default, a table row, or a prompt string. The value is asserted and nothing that
  reads it is called.
- **Fixture asserts fixture.** The assertion reads data the test built, or a value
  computed in `beforeEach`, and the subject never runs in the body. The test is
  `expect(data).toEqual(data)`.

**Assert the output, not the calls.** `expect(slugify("Hello, World!")).toBe(
"hello-world")` is the shape. `expect(spy).toHaveBeenCalled()` tells you the code
ran, which the suite already told you by not crashing.

**For an absence, assert the presence on the other input in the same test.** A
test that only proves the empty case is half a test. `expect(f("")).toBe("")` plus
`expect(f("x")).toBe("x")` in one test is a claim about the function, where the
first is a claim about the absence of a crash.

**For a constant, test the mechanism that reads it with one input.** If the limit
matters, assert what the code does at the limit. `expect(plan({ maxTools: 8 }))
.toHaveLength(8)` fails when the plan honours the limit, and passes when someone
edits the number, which is the opposite of a pin.

**For a mock, assert the payload it received or the state after the call.** A mock
that receives a prompt is worth asserting on, because the prompt is the contract.
A mock whose only assertion is that it was called is a flag dressed as a test.

**Delete the test when no honest assertion is available.** This is the move
people skip, and it is the one that pays. A test you cannot fix is a maintenance
cost with no return, and the coverage number it inflates is the only thing
protecting it.

**Keep the two that fail the mutation for the right reason.** A relation across
rows, such as a key that must appear in two tables or a parent that must exist,
cannot be checked by running one function once, so it fails the mutation and is
still a real test. A compile-time check belongs in a `*.test-d.ts` file for the
same reason. Both are worth keeping, and both are worth a sentence of comment
saying why they do not fit the pattern, since a reader running the mutation will
hit them and wonder.

## What this principle is not

- **Not an argument for fewer tests.** This leaf deletes the tests that observe
  nothing, which is the opposite of a coverage target. `ripwire --seams` is the
  question about what has no test at all, and that is a different problem with a
  different answer.
- **Not "never mock".** A mock is right when the thing you cannot run is the thing
  under test, such as a clock, a network call, or a process. The error is
  asserting that it was called rather than what it was given.
- **Not a licence to test private helpers.** Asserting a private function is
  testing the implementation with extra steps. Assert the public path that reaches
  it, or accept that the helper is not separately covered.
- **Not a rule about how many tests a file has.** One test with five behaviours and
  five tests with one are both fine. The question is whether each one can fail for
  a defect.
