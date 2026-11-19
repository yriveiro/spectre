# Principle: Evidence

Evidence obtains the proof rather than claiming it, complementing `principle-verification`. Two silent failures live here: arguing opinions where an oracle belongs, and trusting a green check that cannot fail.

A reference implementation, compiler, tokenizer, parser, schema validator, upstream tool, real-input corpus, or side-by-side prototype turns a debate into a measurement. Breaking code on purpose and watching the suite go red proves a check carries information. Read the file directly when source settles the question, and measure when claims are unmeasured or checks are unfalsifiable.

## The moves

**Ask an oracle before forming an opinion between plausible designs.** Query an installed parser, tokenizer, compiler, schema validator, linter, or compare two or three prototypes side by side (including UI layouts). Skip competing prototypes when a bug fix or mechanical refactor already has one clear target.

**Break one thing on purpose for every new check.** Mutate or remove the behavior a new test suite, linter rule, scanner, or benchmark inspects, confirm the failure names the right defect, and restore it. Treat a surviving mutation as the cheapest finding of the session.

**Measure the full population and state the denominator with the number.** Three hand-picked cases are an anecdote. Run scanners, parsers, matchers, and formatters across every file or call in the corpus, and write `"1.00 precision on 58 files"` rather than `"perfect precision"`.

**Score before and after on the exact same corpus in both directions.** Keep the old implementation runnable, diff both outputs over identical real inputs, and inspect both gains and regressions. Changing inputs between runs turns a measurement into a story.

**Report false positives next to true positives.** Precision and recall travel together. Quoting recall without false positives lets a noisy scanner look accurate.

**Investigate measurements that contradict your expectation.** When numbers disagree with your preferred change, find the cause rather than picking the flattering reading.

**Benchmark hot-path changes on realistic input and keep the harness.** Time runtime changes against the replaced version before calling them faster, and commit the corpus, oracle, and command so future runs can reproduce the number.

## What this principle is not

- **Not a substitute for judgement.** When options tie on evidence, taste, cost, and project goals decide.
- **Not shipping a measurement instead of the fix.** A number without the change it justifies leaves the work undone.
- **Not unrepeatable theatre.** A benchmark, corpus, or oracle that lives only in a report and cannot be rerun in the repository is just another claim.
