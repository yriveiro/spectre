# Ripwire

## What this skill is

A leaf of Spectre mode, and the only one that names a tool. One rule: **a
principle whose test can be run should not be asserted.**

Every leaf in this set states a test. Some of those tests have a command that
answers them. When one does, run it, because the answer is a fact and the
assertion is a hypothesis. This skill is the map from principle to command.

It also states the other half, which is the half that keeps the map honest: where
ripwire is wrong, what its silence means, and which moments belong to one of the
eighteen moment-skills ripwire installs rather than to a verb you run by hand.

## The rule

Name the principle. Name the test it states. Name the verb that answers the test.
Run it. Report what it said.

```text
principle-verification: its test is "which claim no longer holds"
verb: ripwire --doc-drift
result: two anchors in README.md no longer resolve
```

Write the leaf name and the verb down, because a step you cannot fail is a step
nobody runs. If no verb answers the test, write `no instrument` and say what
stands in for it. That is a complete answer, and it is more useful than a
principle quoted at something it was never about.

## The map

Keyed on the test, not the name. The test is the falsifiable half.

| Leaf | Its test | The verb that answers it |
| ---- | -------- | ------------------------ |
| `principle-laziness-protocol` | where does X come from, what can change it, and what would a deletion have avoided | `--callers` `--uses` `--context-ratio` `--nonlocal-state` `--map-diff` `--clones` |
| `principle-verification` | which claim no longer holds | `--doc-drift` `--mentions` `--test-gate` |
| `principle-evidence` | can this check fail, and has it ever | `--seams` `--exercises=FILE` |
| `principle-make-states-unrepresentable` | can I write a comment saying when this combination of fields is valid | `--seams` names the untested shapes, and the typecheck is the oracle. Whether a sum should have been a union, or whether a struct admits a state nobody can name, is a person reading the type. `--clones` catches the two hand-written copies of one shape. |
| `principle-boundary-discipline` | where did this value enter, and which checks sit below that point | `--uses` `--callers` |
| `principle-hygiene` | what does nothing reach | `--dead-code` `--clones` `--lint` |
| `principle-migrate-callers-then-delete-legacy-apis` | does any caller still reach the old path | `--callers` `--whereis` |
| `principle-test-behavior-not-implementation` | would this test pass if every import returned undefined | `--test-gate` names the tests; the mutation itself has no verb here. `--seams` gives the complement, which is the test that should exist and does not. |
| `principle-outcome-oriented-execution` | is the named end reached, and did a check at the boundary | none. Whether a declared end was reached is a fact about a plan and a diff, not about a graph. The reachability half has an instrument: `--callers` on what the end says should be gone, and `--test-gate` for the check the boundary was supposed to run. Whether the plan still means anything is a person reading it. |
| `principle-make-operations-idempotent` | does the second run converge to the same end state | none. Convergence is a property of a run, not of a graph. The reachability half has a floor with `--exercises=FILE`; whether the second run agrees with the first has no oracle here. The check is running the thing twice, and crashing it on purpose. |
| `no-comments` | does the comment say what the name does not | `--comment-coherence` |
| `principle-guard-the-context-window` | what did this cost | `--token-budget` `--pack-top-n` |
| `i-have-adhd` | does the first line name an action, and is anything left open | none. Whether a message lands is a person reading it. `unslop` is the half that is greppable. |
| `unslop` | would this sentence read the same in another project | none. Rules 13 and 3 are greppable, and a grep for a dash and a grep for an -ing clause cover them. Rule 27 has a mechanical check too: try the sentence in another project's docs. The rest are a person reading it. |
| `model-router` | none | none. The allowlist in `spectre.jsonc` is the check. |

Two rows worth reading twice, because they are the strongest instruments in the
set and neither is obvious from its name:

- **`--context-ratio` is reader load, measured.** It reports, per symbol, how
  much a reader must know that is not in front of them: the in-corpus
  definitions the symbol's references resolve to, and the share defined outside
  its own file. As an edge count and as `read_ratio=`, weighted by the tokens a
  reader actually has to read. This is the two axes of
  `principle-laziness-protocol` as numbers, which is what makes that
  principle's test answerable instead of a judgement.
- **`--nonlocal-state` is the state axis alone.** Per function, the non-local
  mutable state it can reach, most writes first. A function whose `writes=` list
  is long is a function the reader must hold state for.

## Two ways in

**The MCP server**, as `tools.ripwire.*`. Thirty-one verbs, ranked, with lazy
handles, plus `batch` (sixteen read sub-queries in one turn) and `explore`
(one-call orientation with bodies attached). Prefer it when the session has it,
because it ranks and it batches.

**The CLI**, as `ripwire <dir> --flag`. Same engine, and it is the only place
`--test-gate` lives, so the exit-code gate that `ripwire-quality-bar` pairs with
`--quality-delta` is a shell command. Use the CLI when you need a script, an
exit code, or that flag.

Both answer from the same index, so a verb is not a second opinion on the other
one. If they disagree, the index moved between the calls.

## Where ripwire is wrong

The instrument is not the principle, and a map that only says "run this" teaches
deference to a tool, which is the failure `principle-evidence` exists to prevent.
Four things it will not tell you.

**Zero means none found, not none exists.** A count is a floor, never a total.
The index skips files it cannot parse and files above a size limit, and an
unresolved call in a language the parser reads partially is a missing edge, not
an absent call. Run `--skipped` to get the list of what was dropped. A verb that
returns nothing has told you the index does not know, which is a different
sentence from "it is not there".

**The index is a snapshot.** It is built at a point in time. After you edit, a
call from the server may still describe the code before your change. The server
also ships three edit verbs (`insert_before_symbol`, `insert_after_symbol`,
`replace_symbol_body`), so a session can change the code and keep asking the old
graph. Re-index, or read the file.

**Some lenses are disclosed approximations, and the help says which.**
`--readability` runs one token-class table across every language. `--metrics`
states in its own text that coupling is the validated signal and complexity is a
size-correlated one, so treat a complexity number as a size proxy and a coupling
number as a finding. Where a flag publishes its own error bar, read it before
quoting the number.

**`--dead-code` has a known false-positive class.** A symbol registered by a
self-registering test or benchmark macro (doctest, gtest, Catch2, Google
Benchmark) has no caller a name-based call graph can see, so every one of them
would be reported. The flag exempts those four frameworks, and `.ripwire_config`
extends the list. A dead-code hit in a test-heavy tree is worth one look before
you delete anything.

**A path in a doc is not always a claim about this repo.** Measured here, not
assumed: `ripwire . --doc-drift` on this repository reported 26 failed anchors,
and every one of them was an example. `features/model-routing.md` cites
`packages/core/src/tool/plugin/subagent.ts` at five line numbers, and those are
OpenCode's source paths, not this repo's. `i-have-adhd/SKILL.md` cites
`src/auth.ts:42`, which is the Bad example inside a prose rule. The verb reads a
path in backticks and looks for it here, so a doc quoting another project, or
showing a path inside an example, comes back as rot. Open a hit before you act on
it. `--with-history` separates the other false class, a name this repo never had,
from one that was deleted.

## Hand off to the moment-skills

Ripwire installs eighteen skills of its own into
`~/.local/share/ripwire/skills/`, one per moment. They carry the long form of
what this table summarises. When one covers the moment, load it instead of
running a verb by hand.

| This principle's test, mid-task | The skill that owns the moment |
| -------------------------------- | ----------------------------- |
| reader load, in a diff you did not write | `ripwire-fresh-eyes` |
| reader load, before the code exists | `ripwire-before-you-build` |
| reader load, picking a shape out of several | `ripwire-reuse-first` |
| verification, at the moment you think you are done | `ripwire-quality-bar` |
| evidence, finding what has no test | `ripwire-write-tests` |
| the context window, when it is filling | `ripwire-efficient` |
| anything, when the moment is not obvious | `ripwire-router` |

`ripwire-mcp` holds the server's own wiring, including staleness and rebuild
behaviour, and is worth reading once if you use the server heavily.

## Checking this repo's own routing

`--eval-skills` scores which skill fires for which prompt, against a random
floor, with a per-skill blame table. It reads a skill's description from the
YAML frontmatter of its `SKILL.md`, and this repo keeps the description in
`index.ts`, where OpenCode reads it. So the verb sees every spectre skill as
undescribed unless something adds the frontmatter for it.

`test/skills/` does that. `mirror.ts` loads the definitions and writes a temp
tree whose `SKILL.md` files carry frontmatter built from the same objects
OpenCode gets, so the description cannot drift. `routing.test.ts` asserts the
mirror is complete, that no skill reads as undescribed, and that both
description-based and full-text routing beat chance. `fixture.ts` holds the
labelled prompts. Change a description, run `bun test`, and the numbers move.

Routing is mediocre at rank one and good at separation, and the gap is
vocabulary rather than structure. Measured on eighteen prompts written after the
descriptions were reworded and never tuned against: description-based routing
separates the right skill from the wrong one at 0.933 AUC, and puts 7 of 15 at
rank one. Each of the four reworded skills wins at least one of its own rows. The
one left at none is `principle-laziness-protocol`, which was not reworded, and
the prompt that beats it is "where does this value get set", which is the
question its own test is built around.

What survives in the misses is nouns. "can I push this yet" does not match a
description that says "safe to ship". "bump the pin" does not match one that says
"a dependency sitting on an old version". Leading with the moment fixed the
register and left the everyday words missing, and closing that gap needs a fresh
set of held-out prompts, because the current set has now been read.

The test asserts none of this. A per-skill win rate is a number that moves when
any description is reworded, and a gate on it would be red for a reason nobody
can act on in the moment they see it. The AUC floors are the stable claim: the
arm is better than chance, and the descriptions are visible.

## What this skill is not

- **Not a substitute for the leaf.** It routes to the verb. The judgement about
  what the number means belongs to the principle, and a number with no principle
  attached is a fact nobody acted on.
- **Not a claim that the tools are accurate.** Every row here is a place to
  measure, and the section above is the list of ways the measurement misleads.
- **Not a reason to run ripwire on everything.** The map has eight rows. Six have
  a verb. Running a verb because it exists is the same as asserting a principle
  because it sounds right.
- **Not portable to a machine without ripwire.** This skill names a tool on
  purpose, which the principles themselves are written not to do, because naming
  the instrument is this skill's entire content. If ripwire is not installed,
  every principle still stands and this file is the only thing that stops
  applying.
