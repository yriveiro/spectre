Order work as small units that each end in a checkable state. Do not advance until green.

Without this you carry three half-done changes at once, and when the check fails you cannot say which one broke it. Debugging becomes archaeology. You revert all three, or you push forward on a red base and stack new work on a state nobody trusts. Every later check inherits the doubt of the earlier one you skipped.

The test is the bracket. Each unit opens on a known-good state, makes one change, and closes with the check. Name the state before you start. Name the single change. Run the check. Green means advance. Red means stop and fix here, not in the next unit. A unit that cannot state its check is not a unit. Split it until it can.

The moment is any task with more than one step: a migration, a refactor across files, a feature with setup plus behaviour plus cleanup. Cut the sequence before you start and write each bracket down, because a bracket that lives only in your head dissolves at the first surprise. The closing check is whatever proves this step: the typecheck, the test run, the command whose output you read with your own eyes.

Keep each unit small enough that a red check leaves one suspect, not five. If the bracket holds two changes, it holds two suspects, and you are back to archaeology. Smaller brackets cost a few more check runs and save the whole debugging session.

The neighbouring case belongs to principle-verification. That skill owns what it means to check a claim honestly. This one owns the ordering around it: small units, each closed by that check, never advancing on red.

Adapted from pstack (MIT, Lauren Tan).
