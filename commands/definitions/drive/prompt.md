Drive one task to its exit predicate under the built-in goal loop.

Load and follow the `playbook-autonomous-run` skill. Its phases are the run's phases, with one goal active for the whole run.

## 1. Read the objective

Whatever the user typed after `/drive` is the last line of this prompt. The host appends it behind `The user added: `. Take everything after that prefix as the objective.

When the line is absent or empty, ask what the run is for and stop. Do not invent an objective, and do not arm a goal on a guess.

## 2. Name the exit predicate and the check

The goal's reviewer trusts only evidence in the conversation, so the objective must state what "done" means and the exact command that settles it.

- The predicate is a state that can come out false. "The code is better" is not a predicate.
- The check is one command or one `tools.spectre.*` call. The host escapes `&`, `<` and `>` in every goal prompt, so a redirect or a chained command belongs in a script. The tool refuses those characters.
- The predicate must be one this run is allowed to reach. A babysit stops at merge-ready. "Merged" is not its predicate.
- Read `.spectre/run.md` if it exists. Its exit condition and last rows are the current state. Do not overwrite them.

## 3. Arm the goal

```js
const armed = await tools.spectre.goal({
  action: "arm",
  objective: "<the objective>",
  predicate: "<the exit predicate>",
  check: "<the exact command>",
});
```

The tool measures the session's worktree and branch. It refuses the main worktree, a linked worktree on the trunk, a detached HEAD, and a non-repository. It also refuses a child session and an active or paused goal. A field that is empty, multi-line, or contains `&`, `<` or `>` is refused, as is a composition over 4,000 characters. Do not judge those facts yourself.

## 4. Read the result

- `armed`. Say the objective, the predicate, the check and the ledger path in one message. Then stop. If `problems` is present, the goal is running but the ledger header did not write. Repair it next round.
- `rejected`. Read `problems`. If it names the worktree, tell the user to run `/wt <name>` and stop. Otherwise fix the contract and retry once, then report.
- `failed`. Read `problems` and report it. Do not arm again blindly.

Never type `/goal` yourself. The host's command is the surface. This tool is the only path that enforces the contract.

## 5. Work the goal

On the kickoff and on every continuation, do one unit:

1. Read `.spectre/run.md` and the reviewer's `reason` and `next_step`.
2. Make the smallest change the evidence justifies.
3. Run the exact check on the real artifact and quote its output.
4. Append one ledger row. It carries the round number from `tools.spectre.goal({ action: "status" })`, what changed, the check output in one line, whether the predicate moved, and the head SHA.
5. If the predicate is still false, end the turn. The loop re-enters you.
6. If it is true, run the check once more, quote it, and end the turn. The reviewer answers `done`, not you.

If you need a decision, credentials or a manual step only the user can provide, say exactly what and stop. The reviewer answers `blocked`.

## 6. Pause and resume

A pause is the user's `/goal pause`. When it lands, follow `playbook-pause-safely`: a `wip:` commit and a resume note. On `/goal resume`, call `tools.spectre.goal({ action: "status" })`, read the ledger, append a `resumed` row, and take the next unit.
