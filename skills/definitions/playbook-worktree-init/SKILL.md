# Playbook worktree init

A worktree is how a unit of work gets its own directory and branch without
touching the checkout everybody shares. This playbook opens a fresh one and moves
the session into it. Closing a worktree is `worktree-cleanup`.

## Start

Open a `todolist` with one entry per phase.

1. Pick the name
2. Open it
3. Read the result

## Phase A: Pick the name

The name is the directory and, by default, the branch: lowercase kebab-case, at
most 40 characters. Name the change, not the person: `fix-login`, not
`ana-fix-login`.

`start` cuts a fresh branch from the first ref that resolves among `origin/HEAD`,
`origin/main`, `main`, then `HEAD`. Pass `base` only when the default is wrong.

Pass `branch` only for a branch that already exists and that no worktree holds.
`start` cuts the new worktree from that branch instead of `base`, and `cut` says
which ref it used.

Do not survey first. `start` reads the branch state itself, so a `list` before it
buys nothing.

## Phase B: Open it

```js
const w = await tools.spectre.worktrees({ action: "start", name: "fix-login" })
```

That is the only way to open one. `git worktree add` is not the fallback for a
refusal. It creates the directory and leaves this session in main. The work goes
on where you were, and the new directory sits beside it unused. A refused call
has cost you nothing, so read `problems` and call again.

The call moves this session, so it refuses rather than guess. `problems` names
the rule and the answer:

| `problems` says | Do this |
| --------------- | ------- |
| this session is not in the main worktree | Move this session to the `main` worktree it names, and call again. One worktree per session: a session already in one works where it is. |
| this call has no session | The call has nothing to move. Open a session in the main worktree and call again. |
| the branch already exists | If a worktree holds it, work in that directory. If none does, pass it as `branch`: the worktree is cut from that branch and this session moves in. |
| the name is taken | A worktree by that name exists and the host would silently create `<name>-2`. Pick another name. |
| no base ref resolved | `git fetch`, or pass `base` explicitly. A `branch` that already exists does not need one. |

## Phase C: Read the result

Only `status: "opened"` means the worktree is ready, and it means this session is
in it. Report `directory`, `branch` and `cut`, then keep building. `cut` names
the ref the worktree came from: `base` for a new branch, the branch itself when it
already existed.

`unverified` left the directory on disk and did **not** move you. A read
disagreed, so the directory is the evidence: read `problems`, remove that
directory, and call again.

`rejected` created nothing: `problems` names the rule, and the table above names
the answer. `failed` errored and may have left a directory on disk: read
`problems` and the `directory` field before any retry.

Subagents inherit the worktree, so brief them with the path.

## Outputs

A fresh worktree this session stands in, with its path, branch and cut ref
reported.
