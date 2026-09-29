# Principle: Encode Lessons In Structure

An instruction stated twice as prose will be stated a third time, or ignored
once. Prose is read once and forgotten by Friday: the same review comment comes
back on the next change, the same mistake comes back in the next file, the same
warning comes back in the next onboarding, and every return costs the full price
of the first telling, paid by somebody who never heard it. The response is not a
stricter paragraph. It is a lint rule, a metadata field, a runtime check, or a
script, whichever form fails closest to the mistake, and the lesson then travels
with the code instead of with whoever happened to be in the room. This principle
states no falsifiable test and says so plainly: there is no count to pass and no
gate to clear, because recurrence is the signal and recurrence has no threshold you
can check for. What is left is a moment, and the moment is sharp — the second time
you write the same instruction or watch the same mistake return, while the two
examples are still in front of you and the shape is exact.

## The moves

**Do it at the second occurrence.** The first time is an anecdote. The second time
is a pattern, and the pattern is the moment, because the two examples together are
what make the rule exact rather than approximate. Waiting for a third means paying
the telling twice for a rule you could already write.

**Write the lesson in the imperative, as a sentence a machine could check.** Prose
explains why; structure states what. If the sentence cannot be phrased as
something a tool can decide, that is information about the form you should pick,
not a reason to give up on encoding it.

**Pick the form by what has to happen when the rule is broken.** A lint rule when
the mistake is visible in the source. A runtime check when it is only visible when
the code executes. Metadata when the fact has to travel with the code: a schema
field, a config key, a file header, an ownership tag. A script when it is a pass
over the tree. Choose the one that fails closest to the mistake, because the
distance between mistake and report is the cost paid on every recurrence.

**Encode at the cheapest layer that can fail.** A rule in the type or the schema
stops the mistake before there is code to run. A rule in CI runs after the work
has been written, on somebody's afternoon, and reports a defect that could have
been unmakeable. Both are worth having; only one was free.

**Name the exception inside the rule itself.** A check with no escape hatch is
disabled on its first legitimate use, and a disabled check is worse than the
comment it replaced, because it still looks like enforcement. The exception
belongs next to the rule, where the person who needs it will find it.

**Break the code on purpose and watch the check go red.** A rule that has never
fired is not known to work, and shipping one that never fires is the exact failure
this principle exists to prevent. That is `principle-evidence`'s instrument,
pointed at the rule rather than at the code it inspects.

**Delete the prose once the structure carries it.** A comment and a rule saying
the same thing are two sources, and the comment is the one that rots, because it
is the one nobody re-reads. One decision, one source, and the structure is the
source.

**Put the rule where the reader stands when the decision is made.** A check in CI
that is not in the local command fires a week later, on somebody else, as a
surprise. The same rule in the formatter, the pre-commit hook, or the type checker
is met before the mistake is committed, while the context to fix it is still on
screen.

**Phrase it so a stranger can apply it without you.** "Do not do the thing we
discussed" encodes nothing, because it needs the conversation in the room. "Every
exported symbol has a test that imports it" can be checked by somebody who has
never read the thread, and that is the difference between a lesson and a
reminder.

**Keep the reason next to the rule, in one line.** A rule with no stated reason
gets deleted by the next person who hits a legitimate exception, and from their
side the deletion is correct. The reason is what makes the rule read as a decision
rather than as an obstacle somebody put in their way.

**Encode judgements as required artefacts, not as lint.** Some lessons are about
shape and no tool can decide them: a change that adds a flag, a rule that must
stay load-bearing, a boundary that must not move. For those, the structure is a
pull-request template that prints the question, a required decision record, or a
checklist that ships with the code. The claim is the same one: prose in a document
nobody opens is not an encoding.

**Count what you told twice this month, and treat the list as the backlog.** That
count is the only measure this principle has, and it is honest about what it
measures: not the quality of the writing, but how late the structure is. Every
item on it is an instruction still being paid for, and each one is a day of
repetition you have not spent yet.

## What this principle is not

- **Not a licence to encode everything.** A rule for a case that has not recurred
  fires on a legitimate use, and a rule that fires wrongly is how a linter gets
  turned off for the whole project. Two occurrences is evidence; one is an
  anecdote, and the cost of a wrong rule is paid by everybody.
- **Not a replacement for saying it out loud once.** Structure encodes a lesson you
  have understood. A rule you do not yet understand is a rule that will be wrong,
  and the fix is one conversation rather than a new file.
- **Not "make it a lint rule" by default.** A check that cannot see the mistake
  settles for a proxy: a naming convention standing in for an intent, a comment
  required as evidence of a change. Prefer the check that can see the thing,
  because a check on the proxy teaches the proxy.
- **Not a blocker on the change in front of you.** Encoding is the follow-up, in
  the same change where the pattern was second-observed or immediately after it.
  Adding a rule to a codebase so one ticket can pass is a cost with no return.
