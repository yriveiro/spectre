# TDD Bug Fix

Make the broken behavior executable before you change production code, so the
fix is a change that turns something red green rather than an edit you believe
in.

`principle-test-behavior-not-implementation` owns the shape of a good assertion:
what the test should say once it exists. This procedure owns the order, which is
the other half. The failing run comes first, before any production edit, and it
is the only thing that shows the test can fail at all.

Skip it when the test path is unclear, expensive, or integration-heavy, and say
which of those it was. A skipped procedure with a stated reason is a decision; a
skipped procedure with no reason is a hole in the report.

## Start

Open a `todolist` with one entry per phase before launching anything.

1. Pin
2. Choose the check
3. Write it red
4. Watch it fail
5. Fix
6. Hand back

## Phase A: Pin

1. Write down the intended behavior and the current behavior as two sentences.
   If you cannot say what it should have returned, you do not yet know the bug,
   and a test written from a guess pins the guess.
2. Find the smallest observable reproduction. The narrowest input that shows the
   wrong answer, not the one the reporter happened to use.
3. Name the path, not the file. "Where does this value get read" is a path; a
   filename is a guess about where to look. When the stack trace names a frame
   you do not recognize, `ripwire.from_trace` starts from the trace rather than
   from a guess about which project owns it.
4. Get a current green first if the suite has one. A red suite before you start
   means the bug is not the only thing that is broken, and you will not be able
   to tell your failure from the noise.

## Phase B: Choose the check

Take the narrowest executable check the codebase already uses for that path: an
existing test file for the same module, the same layer, the same kind of input.
Reuse the harness that is there, because a new test framework for one bug is a
cost nobody asked for and a reason for the next person to delete your test.

Do not build a harness from scratch to satisfy the workflow. If the honest
options are a broad fixture, brittle mocks, slow end-to-end infrastructure, or
state you cannot reproduce outside production, the answer is the closest
executable check rather than a bad test.

## Phase C: Write it red

Add the smallest test that would have caught this bug, asserting the intended
behavior rather than the current one.

Assert the output, not the calls. `expect(f("")).toBe("")` plus
`expect(f("x")).toBe("x")` in one test is a claim about the function; the first
half alone is a claim about the absence of a crash. And do not take the expected
value from the code under test, because both sides then run the same logic and
the comparison cannot fail. The leaf named above owns that in full; here it is
one rule applied while the test is still being written.

## Phase D: Watch it fail

Run the new test before editing anything in production.

It has to fail, and it has to fail for the intended reason. Read the failure
message and check that it names the defect you are fixing, not a missing import, a
wrong fixture, or a typo in the test.

A test that passes before the fix is a test of something else, and you have just
learned that the bug is not where you thought. A test that fails for the wrong
reason is a broken test, and both cases send you back to Phase A rather than
forward to Phase E. This is the step everybody skips, and skipping it is how a
suite full of tests that cannot fail reports itself as a green suite.

## Phase E: Fix

Make the smallest production change that satisfies the intended behavior and
leaves nearby contracts alone. A change that also tidies the neighbouring module
is two changes, and you will not be able to tell which one turned the test green.

Do not edit the test to match a wrong implementation, and do not weaken an
existing assertion unless the expected behavior genuinely changed and you can say
why in one sentence.

If the bug exposes a whole class of the same failure, land the one focused
regression path first, then add the siblings as separate changes. A test file
that grows by thirty cases in one commit stops being reviewable, which defeats
the reason you wrote it.

## Phase F: Hand back

Report the evidence, not the outcome. A green suite is a one-word report that
the reader cannot check.

- The test you ran before the fix, and the failure it produced, quoted.
- The test you ran after, and anything else you ran near it.
- If the failing-before run was not possible, why, and what you ran instead.

When no failing test was practical, the substitute is a real executable check and
it is named as one: a script that calls the real code, a browser step, a log
assertion, a snapshot diff. What is not acceptable is a fix with no check, and
what is worse than either is a test that mostly exercises mocks, pins an
implementation detail, depends on timing, or would be deleted the moment it went
green. Prefer no test over that one.