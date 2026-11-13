# Playbook worktree

A worktree is how a unit of work gets its own directory and branch without
touching the checkout everybody shares. `tools.spectre.worktrees` opens one,
moves this session into it, and later takes it away. This playbook is the whole
lifecycle. Reclaiming abandoned trees is `worktree-cleanup`.

## Start

Open a `todolist` with one entry per phase.

1. Pick the tree
2. Open it
3. Read the result
4. Work in it
5. Close it

## Phase A: Pick the tree

One worktree per unit of work, and one session per worktree. The name is the
directory and, by default, the branch: lowercase kebab-case, at most 40 characters.
Name the change, not the person: `fix-login`, not `ana-fix-login`.

Pass `branch` only for a branch that already exists and that no worktree
holds. `start` cuts the new tree from that branch instead of `base`, and `cut`
says which ref it used. Pass `base` only when the default is wrong. The defaults,
in order, are `origin/HEAD`, `origin/main`, `main`, then `HEAD`.

Do not survey first. `start` reads the branch state itself, so a `list` before it
buys nothing. When you do need the survey, `list` returns one row per worktree,
and `worktree-cleanup` owns how to read the buckets.

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

## Phase D: Work in it

Subagents inherit the worktree, so brief them with the path. The branch is the
unit of work, so a second run on the same branch is a second worktree, or a reset
between them:

```sh
git fetch && git reset --hard origin/<branch>
```

A branch carrying unrelated work: patch it out, take a fresh worktree, apply the
patch. A worktree too snarled to reason about: reset from main and redo the
smallest version. Do not untangle it in place.

## Phase E: Close it

Leave the directory alone until the work ends. Then:

```js
await tools.spectre.worktrees({ action: "remove", directory: w.directory })
```

`remove` never deletes a branch, never removes the main worktree, and has no
force. A dirty tree comes back as `failed` with git's own message, and that
refusal is the guard. When this session is standing in the directory being
removed, the tool moves it to `main` first and names the new place in `moved`.

`removed` means the directory is gone and the branch is kept, because a branch is
somebody's work. `already-gone` means the directory was already collected, so a
second removal is not an error.

`worktree-cleanup` owns the branch deletion rule and the survey that decides
which other trees may go. This playbook does not override those buckets.

## Outputs

An open worktree this session stands in, with its path, branch and cut ref
reported. Or a closed worktree with the session back in main.
