# Ripwire first

The moment map: one verb per moment, read once per session.

# Code search
A search for code is `spectre_search`, not `ripgrep`. It answers a question or a
literal with the enclosing symbol, and it ranks what to read first. `ripgrep` is
for plain text: logs, docs prose, fixture data, lock files. A code-shaped
`ripgrep` call is answered by `spectre_search` once, and the answer says so.

## The map

| Moment | The verb | For depth |
| ------ | -------- | --------- |
| search | `spectre_search`. Keep `literal: true` on `ripgrep` for verbatim text. No grammar gives a thin map, not an empty repo. | `ripwire-mcp` |
| first read | `--for=TASK` before opening files. A named symbol serves its body inline, so read it there. `--expand=SYM` for the body the answer withheld. One plain `ripwire <dir>` per session. A thin answer (`coverage=` under 50, head under three files) widens with `--limit=40`, never a file read. | `ripwire-orient` |
| before a new symbol | `--exemplar=TASK` for the shape to imitate, `--lego=Iface` for the contract, `--defs=NAME` for an ambiguous name. `--lego=I` lists the contract. Read one implementor as the template. | `ripwire-before-you-build` |
| edit contract | `--impact=SYM` and `--uses=SYM` before the edit: depth plus breadth. `--callers` is one hop, a different question. Then `--edit-check=SYM`, which refuses on an ambiguous name: pass `file:name`. | `ripwire-navigate` |
| fan-out | `--pack-task=TASK --partition=N`: one core, N slices. The wrapper carries `split=` and `core_overlap=` too. `--token-budget` there is one agent's budget, and one module is one agent. | `ripwire-orient` |
| before done | `--quality-delta`, `--edit-check`, `--affected`, then run the tests. Read `gating=`, not `regressions=`: exit 0 means nothing that existed got worse, so open the `origin="new-symbol"` rows. `--test-gate` is the PR gate (exit 4) and cannot watch the run: run the named tests. Quote the `at=` sha with any number you paste. | `ripwire-quality-bar` |
| session memory | `--recall=TASK` for a task's docs, `--note-add="TARGET: text"` for the decision, not a description. A note resurfaces on `--for`/`--expand`; an ambiguous name is refused. | `ripwire-orient` |
| branch cleanup | `--stray-content` before deleting a branch, `--whereis=SYM` for the tree defining it, then `--plan` for the landing order, which needs `--stray-content`. | `ripwire-change-check` |
| doctor | `--doctor` before doubting an answer, `--skipped` for what the index left out. | `ripwire-mcp` |

The moments with no row: `ripwire-find-bug` a symptom, `ripwire-fresh-eyes`
code you did not write, `ripwire-write-tests` untested code, `ripwire-handoff`
a successor's brief, `ripwire-perf-target` a measured slowdown.
`ripwire-security-scan` a skill or MCP config. `ripwire-router` indexes
the rest.

A count is a floor, a name-only edge carries `via="name"`, and the index is a
snapshot, not the tree. Every later call keeps `--legend=compact`, `--for`
included.
