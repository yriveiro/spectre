# Show me your work

Keep one decision log, one row per decision, so the reasoning survives the run
that produced it.

`tools.spectre.history` already reads commit messages and blame, and it is the
right tool for "why does this line look like this". Git records what changed. A
decision log records what you rejected on the way there, and git has no column for
that: the option you weighed, the thing that ruled it out, the pivot and what
triggered it. That is the half a reviewer cannot recover from the repository.

## Start

Open a `todolist` with one entry per phase before launching anything.

1. Open the log
2. Decide what earns a row
3. Write the row
4. Keep it straight across runs
5. Audit it before handing back
6. Have another model read the trail

## Phase A: Open the log

One TSV file, six columns, header written on the first write:

| column | what goes in it |
| --- | --- |
| `ts` | ISO 8601, UTC. |
| `phase` | the phase or workstream the decision belongs to |
| `decision` | what was chosen or done, one line |
| `why` | the reason in plain words. A principle that drove it goes in prose, not as a tag. |
| `evidence` | a pointer: commit SHA, PR number, `file:line`, artifact path. Never a paragraph. |
| `result` | the outcome or the state: `tests green`, `reverted`, `pixel-diff 0`, `INCONCLUSIVE`, `open`. |

Default location is `decisions.tsv` in the work directory, or
`.audit/<task-slug>.tsv` when several efforts run at once, and it stays out of git.
Commit it only when a reviewer has to trust the result without you in the room.

The file is tab separated and people open it in a spreadsheet, so the bytes matter.
Write the header only when the file is empty. Append with `>>`, never `>`, or a
failing write on a network mount costs you the rows rather than one stray header.
Turn tabs and newlines into spaces so every cell stays on one line. Prefix any cell
starting with `=`, `+`, `-` or `@` with a single quote: a PR title or a filename is
attacker-shaped input the moment it lands in a cell.

## Phase B: Decide what earns a row

Decision points and checkpoints. A fork taken. A unit finished with its
verification result. A pivot or a revert, with the trigger. A blocker surfaced. A
gate fixed. For a loop, one row per iteration.

Not every action. The test is whether a reader in six months with no memory of this
run would ask "why is it like this" and find the answer in the row.

## Phase C: Write the row

Write it the way you would tell a teammate. Plain words, the concrete action, no
filler. Prefer evidence a committed script produced over something hand-made to
look thorough.

Append only. A wrong call gets a new row that supersedes it, never an edit and
never a delete.

## Phase D: Keep it straight across runs

A run is one agent conversation, including its later turns and any summary of it. A
pickup, a replacement, or a new session starts a new run.

A run that adds to a log which already has rows opens with phase `start`, and so
does the first row after another run's `start`. Coming back to a log later, read
its last rows first to see whether anyone wrote since. A `start` row names the `ts`
range of the rows before it that this run did not write, and its evidence names the
run. Use phase `start` for nothing else.

## Phase E: Audit it before handing back

There are no session transcripts here to walk the log against, so the audit runs
against the repository, which is the thing every claim is about.

For each row of this run: does the evidence resolve, and does what it points at
show what the row claims. Is there a fork, a pivot or a rejected approach that
shaped the work and never got logged.

Fix the log, not the story. Never edit or remove a row, even one that turns out to
be invented. Supersede it with a row that says what actually happened and points at
something that resolves.

## Phase F: Have another model read the trail

Spawn one reviewer on a different family from yours, taken from
`tools.spectre.routing({})` rather than from memory. Self-review is not a
substitute.

It reads the trail and flags what the reader should pay attention to. Not a redo of
the work: a scan for decisions with thin or absent evidence, verification claimed
rather than shown, choices that look risky now that you know the outcome, and gaps
a casual skim would miss.

## Outputs

The TSV, plus an `Attention` section closing the reply. It opens with
`reviewed by <model>` on its own line, then one flag per item pointing at specific
rows. "No flags" is a valid value. The model name is not.
