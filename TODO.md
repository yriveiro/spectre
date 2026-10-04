# TODO

Where the pstack port stands. Two things here are blocked on a human and one is
blocked on a measurement, and both say so rather than sitting as undone work.

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
| 22 playbooks plus a `playbook` index | registered and not indexed; the hub grew by 376 bytes for all 23 |
| Reachability and map-drift tests | both verified to fail before being kept |

## Next

Nothing in the port is left unplanned. The two rows below are the remainder, and
both are blocked on a person rather than on work.

## Blocked on a human

| Item | Unblock |
| ---- | ------- |
| Eval rows for the 16 new principles | step 4 of the porting checklist. `eval/fixture.ts` has 89 rows covering 11 of 27 principles; the 16 have none, so "these are an improvement" is currently an assertion rather than a measurement |
| `bun run eval -- --held-out` | delete the `"plugins": ["github:yriveiro/spectre"]` line from `~/.config/opencode/opencode.jsonc`. The eval reads OpenCode's own `Registered skills` log line, it reported `20 of our 36` with the 16 missing being exactly the new principles, and it refuses to score rather than grading against a catalogue nobody confirmed |

The precedent for why this matters is in `skills/FOR_AGENTS.md`: going from 10
leaves to 13 cost 9.3 points of held-out `bm25-full` hit@1, about 3 points per
leaf, and no description rewrite recovered it. Sixteen principles landed without
a row to measure them, so the cost is unknown rather than absent.

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
| 150 semicolons | tracked by `test/tools/prose.test.ts`, which fails when the count drops. `tools.spectre.prose` finds them in one call |
| `dictionary` path | yours to set. The repo copy carries the line commented out, so nobody else inherits your `~/Dump` path |
| dictionary export | the extractor from the PDF is not written. The export exists; regenerating it does not |
| the two routing misses | `summarize what you just changed` and `reply with just the answer, no preamble` still go to playbooks. Not fixable by description, see the PR body |
