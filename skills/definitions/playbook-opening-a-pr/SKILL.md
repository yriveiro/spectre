# Playbook opening a PR

Turn finished work into pull requests a reviewer can land. Every other playbook
ends here, and this one does not continue to babysit or ship.

## Start

For a single pull request, run the fast path in three moves without opening a
`todolist`:

1. Read `<pr-preflight>` when `/pr` attached it. Do not repeat `git status`,
   `git branch`, `git config commit.gpgsign`, or `which ripwire`.
2. Run the project validation check plus `ripwire . --quality-delta` and
   `ripwire . --affected=<paths>` (or `tools.spectre.ripwire({ action: "check" })`)
   when the branch changed code.
3. If uncommitted branch files belong in the PR and `gpgsign` is `true`, call
   `yubikey_unlock` once, then call `tools.spectre.pr` once with `commit` set.

Open a `todolist` only when Phase C splits the branch into a multi-PR stack.
Never edit source or workflow files during `/pr` unless the user asked for a fix.
Skip `interrogate`, `code-hygiene`, `technical-writing`, and `grammar` skill loads
unless the user passed `--review` or a `prose-*` rule refused your draft.

## Phase A: Worktree

Never edit the main checkout, and never cut a branch in place. Open the branch
with its worktree:

```ts
await tools.spectre.worktrees({ action: "start", name: "fix-login" })
```

Never run `git worktree add` as a fallback. That command creates a directory and
leaves this session standing in `main`. Read `problems` on a refusal and act on
the exact reason:

| `problems` says | Action |
| --------------- | ------ |
| this session is not in the main worktree | Work in the current worktree, or move to `main` before opening a second one. |
| this call has no session | Open a session in the `main` worktree and call again. |
| the branch already exists | Work in the worktree holding it, or pass `branch` to attach it. |
| the name is taken | Pick another worktree name. |
| no base ref resolved | Run `git fetch`, or pass `base` explicitly. |

Only `status: "opened"` confirms the worktree is ready and this session moved into
it. On `unverified`, read `problems`, remove the directory, and call again.

## Phase B: Commits

Prefer passing `commit` directly to `tools.spectre.pr` when uncommitted branch
files belong in one commit. The tool stages only `commit.files` (`git add --`) so
untracked files such as `spectre.json` stay untouched, formats the commit message,
and converges on retry if `HEAD` already holds that commit.

Every commit message uses this shape:

```text
<type>(<scope>)[!]: <concise imperative subject>

# Description
<one sentence, 8 to 25 words: the primary staged change>

# Changes
- <concrete staged change>
- <concrete staged change>

[# Breaking Changes
- <incompatibility and required migration>]
```

Write one to four `# Changes` bullets with plain verbs (`add`, `remove`, `update`,
`replace`, `rename`, `refactor`, `correct`). Do not claim behavior stays the same
or infer runtime effects absent from the diff.

When `gpgsign` is `true`, call `yubikey_unlock` once before committing. If the PIN
modal cancels or no card is present, stop and report that in one line. Never loop
over `gpg`, `scdaemon`, or `ps`.

## Phase C: Split

Inspect commits ahead of trunk:

```sh
git log --oneline <trunk>...HEAD
```

Two subjects wanting different scopes, or two unrelated justifications, belong in
two pull requests. Refactoring and behavior changes also split into separate
commits. When uncommitted edits mix two unrelated scopes and the split is
ambiguous, ask one question before committing.

## Phase D: Parallel preparation

For a single pull request without `--review`, mark this phase `n/a` and run your
validation checks directly without spawning subagents.

Use subagents only when opening a multi-PR stack, delegating packaging out of a
long coding session, or running `--review`. Load `model-router` and call
`tools.spectre.routing({ task: "<one lane>" })`. A command check or single-PR
packaging fits `mechanical` or `worker`. A call-site scan fits `search`. Semantic
diff review under `--review` fits `judgment`, not `thinking` or `deep`. Pass the
selected profile's `agent` and exact `model.ref`, and keep one owner for branch
writes.

## Phase E: Title and body

Never hand-write pull request markdown or temporary scratch `.md` files on disk.
`tools.spectre.pr` composes the title and body, checks structure and ASD-STE100
hard prose rules in memory, pushes, and opens or updates the pull request:

```js
const pr = await tools.spectre.pr({
  action: "open", // pass "compose" on GitLab or when only title + body text is wanted
  commit: {       // omit when every change is already committed
    files: ["tools/definitions/stack/read.ts"],
    description: "Report unreadable GitHub pull request rows instead of treating them as clean.",
    changes: ["return unreadable state when gh pr list fails"],
  },
  type: "fix",
  scope: "spectre",
  subject: "report reading a PR gh could not",
  summary: "A row gh could not read looked clean, so a broken stack reported clear.",
  review: "Does unknown stay distinct from clear across every caller?",
  scopeItems: ["tools/definitions/stack/read.ts"],
  validation: [
    { check: "bun test test/stack", result: "17 pass, 0 fail" },
    { check: "ripwire . --quality-delta", result: "regressions=0 gating=0" },
    { check: "ripwire . --affected=tools/definitions/stack", result: "tests=12 reached=64" },
  ],
  risk: "Changes stack error reporting. Reverting the file restores the prior check.",
})
```

For GitLab repositories (`forge: gitlab`) or requests that ask only for a title
and body, pass `action: "compose"`. The tool validates all fields in memory and
returns `{ status: "composed", title, body }` with zero `git` or `gh` calls.

### Rules the tool enforces

- **Title:** `<type>(<scope>)[!]: <subject>` under 72 characters, lowercase scope,
  no trailing period, and one clause (`and`, `;`, and `,` in `subject` fail).
- **Body cap and shape:** At most 40 lines, no commit SHAs, no numbered commit
  lists, no heading inside `summary`, and no optional field set to `None.`.
- **Prose:** Active voice, plain words, no semicolons, no phrasal verbs, no
  marketing adjectives, and at most 25 words per sentence.
- **Validation:** Run `ripwire . --quality-delta` and `ripwire . --affected=<paths>`
  after the last code change, and give each its own validation bullet with the
  exact output. A branch that changed no code file states that fact in the bullet
  that carries its test result.

## Phase F: Stack

A branch that splits in Phase C becomes a stack of base branches. Rebase each
child onto its parent's exact tip and pass `base: "<parent-branch>"` to
`tools.spectre.pr`.

## Phase G: Open

`status: "created"` or `status: "updated"` confirms the pull request is live on
GitHub. On SSH remotes where hardware-key signing fails in headless mode, the tool
automatically retries the push once through `gh` HTTPS credentials without editing
`.git/config`.

**Authorization and pause boundaries.** Invoking `/pr` authorizes staging branch
files, committing, pushing without `--force`, and opening or updating the pull
request, even when CI triggers a `plan` workflow or requests gated deploy
approval. Pause and ask only before a `--force` push to a shared branch, a
production deploy you execute directly, a branch or file deletion, or when `main`
has zero changes.

## Phase H: Handover

Post the URL, branch, base, and commits, then stop. Do not start `playbook-babysit`
unless the user asks for it.

When a long coding session delegates PR packaging to a subagent, route that child
on `worker` or `mechanical` through `model-router` so it runs in a fresh small
context, calls `tools.spectre.pr` once, and returns the URL.
