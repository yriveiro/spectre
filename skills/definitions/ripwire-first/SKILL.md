# Ripwire first

The moment map: one verb per moment, read once at the start of a session.
`ripwire` holds the principle-to-verb table, and where the instrument is wrong.

# Code search
A search for code is `spectre_search`, not `ripgrep`. It answers a question or a
literal with the enclosing symbol, and it ranks what to read first. `ripgrep` is
for plain text: logs, docs prose, fixture data, lock files. A code-shaped
`ripgrep` call is answered by `spectre_search` once, and the answer says so.

## The map

| Moment | The verb |
| ------ | -------- |
| search | `spectre_search`. The rule above is the whole of it. |
| first read | `--for=TASK` before opening files, then open what it ranks: `--signatures-only` for the shape, `--expand=SYM` for one body. |
| before a new symbol | `--exemplar=TASK` for the example to imitate, `--lego=Iface` for the contract and its implementors, `--defs=NAME` when a name is ambiguous. |
| edit contract | `--impact=SYM` before the edit, `--edit-check=SYM` after: did the contract change, and which callers no longer fit. |
| fan-out | `--pack-task=TASK --partition=N` for N agents: one shared core and N slices. Read `overlap_max=` before trusting them. |
| before done | `--quality-delta`, then `--affected=FILE` or `--affected=SYM`, both after the last edit. The landing gate asks for these two. |
| session memory | `--recall=TASK` for the docs a task should read, `--note-add="TARGET: text"` for the note the next session needs. |
| branch cleanup | `--stray-content` before deleting a branch, `--whereis=SYM` to find the tree that still defines it, `--plan` for the landing order. |
| doctor | `--doctor` before doubting an answer, `--skipped` for what the index left out. |

Hold three things while you read an answer: a count is a floor, an edge matched
by name alone carries `via="name"`, and the index is a snapshot of the tree at
the last parse.
