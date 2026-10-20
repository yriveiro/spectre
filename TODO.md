# TODO

Where the pstack port stands. Nothing in it is waiting on a person.

Read `skills/FOR_AGENTS.md` before adding a leaf. Three of the rows below exist
because that file's rules put them there, not because they were planned.

## Done

| Item | Notes |
| ---- | ----- |
| `tools.spectre.comments` | comment and suppression inventory |
| `tools.spectre.routing` | the model allowlist, checked against the live catalogue |
| `tools.spectre.worktrees` | every worktree bucketed from git and `gh` evidence |
| `tools.spectre.stack` | tier-major verdict over a pull request stack |
| `tools.spectre.history` | git archaeology: commits, bodies, blame, pickaxe |
| 16 principles from pstack | refit to the body template, 1000 to 1500 words each |
| `ripwire` map row per leaf | 31 rows, and the `none` count synced to the hub |
| 14 procedures from pstack | registered and not indexed, per rule 3 |
| `why` | the surviving seventh of pstack's seven evidence categories |
| 23 playbooks plus a `playbook` index | registered and not indexed; the hub grew by 376 bytes for the first 23 |
| Reachability and map-drift tests | both verified to fail before being kept |
| The blind slice | 37 fresh rows, and `eval/tests/fixture.test.ts` holds the bar that keeps a row from quoting the description of the leaf it names |
| Eval rows for the 7 principles without them | 3 rows each, and the blind slice reads 14 of those 21 at rank one |
| The map's complexity sentence | the map now says what the defect literature says about churn and complexity, names `--rank-by=churn` as the ranking to use, and points at `features/code-hardness.md` for the sources |
| The eval's hit-rate column | `eval/run.ts` read ripwire's AUC as hit@1, so the random arm read 50.0% and every lexical arm read high. It now reads the first column and scores over the judged rows: 75.8% (25/33) on the blind slice, and 1.2% for random |
| The model arm of the eval | five free models against 82 of 82 registered skills, 3 to 6 of the 37 blind rows at rank one, and no spectre skill loaded. The catalogue check that had it blocked reads OpenCode's own log line and refuses to score on a mismatch |
| Ripwire's skills in the eval's mirror | the mirror now holds our 82 bodies and ripwire's 17 skills, the rivals the model arm's catalogue always carried. With them in, the blind description arm reads 72.7% (was 75.8% rival-free) and the whole set 97.4% (was 99.4%) |

## Next

Nothing in the port is left unplanned. The rows below are the remainder, and each
is work rather than a person. The evidence behind these rows sits in
`features/code-hardness.md`.

| Item | Notes |
| ---- | ----- |
| A leaf for the moment where you choose where to look first | no leaf owns it, and `ripwire --rank-by=churn` answers it. The ranking is a place to start and not an oracle, and the leaf has to say so |
| Ownership in the history tool | `tools.spectre.history` already returns the authors of a file's history, and the minor-contributor count is the strongest single predictor in the defect literature |
| A fresh blind batch, written by a writer that never saw the descriptions | every leaf with a row in the current blind slice now wins at least one of them, so the slice no longer separates one leaf from another. The four-word bar catches a row that quotes a description and not a row that copies its shape |

## Deliberately not ported

Each for a stated reason, not for lack of time.

| pstack skill | Why not |
| ------------ | ------- |
| `why`'s other six evidence categories | Linear, Notion, Slack, Datadog, Sentry, Databricks. The setup is git only. `why` here is the seventh alone |
| `make-bot-ui` | Grok Bot webhooks, Tailscale, a Cursor Routines panel |
| `recall`, `reflect` | mine `~/.cursor/projects/*/agent-transcripts`; opencode keeps sessions in drizzle SQLite and there is no equivalent to point at |
| `setup-pstack` | `spectre.jsonc` and `tools.spectre.routing` do this, and the routing tool also checks every ref against the live catalogue |
| `blast-radius` as a port | already `ripwire.impact` and `ripwire.edit_check`; the procedure around it says so rather than reimplementing |
| `interrogate` as a port | already `arena` plus `model-router`; the procedure states the difference, which is that arena builds and interrogate breaks |

## After the STE branch

| Item | Where it stands |
| ---- | -------------- |
| 191 semicolons | paid. Every one was read in its paragraph. `test/tools/prose.test.ts` now reads the whole repo and expects zero, so a new file cannot add one back |
| the passive voice count | 321, and the number is the decision. Every finding is a statement of state about code, where the actor is not the subject. `tools.spectre.prose` reports it as advisory for that reason. The rule that passive is correct when the actor is unknown is also what `references/meaning-fidelity.md` calls Pass 3, and it adds that inventing an actor is a fabrication. If you want it active, say so and it is 321 sentences |
| `dictionary` path | yours to set. The repo copy carries the line commented out, so nobody else inherits your `~/Dump` path |
| dictionary export | the extractor from the PDF is not written. The export exists. Regenerating it does not |
| the two routing misses | `summarize what you just changed` and `reply with just the answer, no preamble` still go to playbooks. Not fixable by description, see the PR body |
