Drive a stack of pull requests to merge-ready under the built-in goal loop.

Load and follow the `playbook-babysit` skill. This command is the goal-shaped entry to that procedure, not a second loop. The stack never merges here.

## 1. Read the stack

Whatever the user typed after `/babysit` is the last line of this prompt, behind `The user added: `. Take the PR numbers and any mode from it.

When the user names numbers, use them. When the line is absent, call `tools.spectre.stack({})` and use the open stack it returns. When that returns no rows, say there is nothing to babysit and stop. Never arm against an empty stack.

## 2. Name the predicate and the check

- Predicate: `tools.spectre.stack` returns `clear` for the stack, no unresolved review threads remain, and every check is green. Merge-ready is the exit.
- Check: `tools.spectre.stack({ prs: [...] })`, one call per round. Read `stack`, `blocker` and `problems`.
- Never make "merged" the predicate. This procedure does not authorize a merge, an auto-merge, or a merge-when-ready arm.
- If the verdict is `waiting` and a goal is armed, start the native background shell: `shell({ command: "gh pr checks <pr> --watch", background: true })`. Say which check it is, and end the turn. The goal's reviewer may answer `wait`, and the shell's completion wakes the session. Never poll, never sleep, never hold the turn open.
- Without a goal and with `experimental.schedules` on, use `tools.opencode.schedule_create({ until: { run: "gh pr checks <pr> --json bucket --jq '[.[] | select(.bucket == \"pending\")] | length' || true", is: "0" }, prompt: "PR <pr> checks finished. Re-read tools.spectre.stack and continue playbook-babysit." })`. Without schedules, say which check you are waiting for and stop.

## 3. Arm the goal

```js
const armed = await tools.spectre.goal({
  action: "arm",
  objective: "Take PRs <numbers> to merge-ready",
  predicate: "tools.spectre.stack returns clear and no unresolved review threads remain",
  check: "tools.spectre.stack({ prs: [<numbers>] })",
  playbook: "playbook-babysit",
});
```

The tool measures the session's worktree and branch. It refuses the main worktree, a linked worktree on the trunk, a detached HEAD, and a non-repository. It also refuses a child session, an active or paused goal, and a contract over 4,000 characters. If it refuses for the worktree, follow the instruction in `problems` and stop. If it refuses for a goal or a field, fix that instead. Do not judge those facts yourself.

## 4. Work the frontier

Follow `playbook-babysit`: the lowest unmerged PR is the frontier. Fix conflicts, then review threads, then CI. Batch every fix into one push wave. Never mutate stack topology from inside the run. Never merge.

Every round reads `stack` once and ends the turn. On `continue`, read the reviewer's `reason` and `next_step` and take the next frontier item. Do not repeat a fix the ledger says is done.

Owner approval is `blocked`, not a blocker to fix. Say what the owner must decide, and stop. The user approves and types `/goal resume`.

## 5. Pause and resume

A pause is the user's `/goal pause`. When it lands, follow `playbook-pause-safely`: a `wip:` commit and a resume note. On `/goal resume`, call `tools.spectre.goal({ action: "status" })`, read the ledger, append a `resumed` row, and take the next frontier item.
