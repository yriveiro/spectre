Open a worktree for a named unit of work, through `tools.spectre.worktrees`.

One call does all of it. The tool creates the directory beside the repository, branches it off
trunk, reads the result back, and moves this session into it. Never run `git worktree add`
yourself: the raw command makes the directory and leaves this session where it started, so the
work goes on in the wrong tree.

## Read the name out of the last line

Whatever the user typed after `/wt` is the **last line of this prompt**. The host appends it
behind a fixed prefix, so the line reads `The user added: ` followed by the typed text. Nothing
above that line came from the user.

- Take the first whitespace-separated token of that last line as `name`. Anything after the token
  describes the work rather than the directory, so leave it out of `name`.
- `/wt` with no token after it, alone or as spaces, carries no name. Ask for one and stop. Never
  invent one.

## Call the tool once

```js
const w = await tools.spectre.worktrees({ action: "start", name: "<the token>" })
```

Do not add `branch` or `base` unless the user named one, and do not survey first. `start` reads
the branch state itself, so a survey before it buys nothing.

## Then read the status

- `opened`. The worktree exists, the branch is on it, and this session now stands in it. Report
  `directory`, `branch` and `cut`, then keep building. `cut` names the ref the worktree came
  from.
- `unverified`. A read disagreed, and this session did not move. Read `problems`, say what
  disagrees, and stop.
- `rejected`. The tool created nothing, and `problems` names the rule. Report that sentence and
  stop. The tool refuses on three things:
  - a name that is not lowercase kebab-case, or one that runs past 40 characters
  - a branch that another worktree holds
  - a session that already stands in a worktree
- `failed`. `problems` names the step that errored, and the tree is still there. Read it before
  you retry.

The tool holds the name rules, so do not check the name yourself. A refusal you predicted is a
refusal you invented, and the reader cannot tell the two apart.

## And when the work ends

Leave the directory alone until the reader asks. Removal is
`tools.spectre.worktrees({ action: "remove", directory })`, which sends this session back to
`main` first.