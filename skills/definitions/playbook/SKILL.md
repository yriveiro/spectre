# Playbook

Twenty-two procedures, one per shape of task. This file is the index and the
selection rule; each playbook is a folder beside it.

`principle-*` tells you how to hold yourself while you work. These tell you what
to do and in what order. A principle has no phases; a playbook does. If a request
is small enough that the order does not matter, no playbook is the right answer
and a principle or nothing is.

## The rule

**Match the shape of the task, not its topic.** "The login page is slow" is a
perf task whichever feature it is in. "Rewrite the auth module" is a refactor
even though it touches login. Getting this wrong is the expensive error here: the
wrong playbook is a complete, confident, well-executed sequence of the wrong
steps, and it looks exactly like good work until the end.

Three things force a choice over a bare request:

1. **Is anything wrong?** Reproduce before you change anything. `playbook-bug-fix`.
2. **Is it too slow?** Measure before you change anything. `playbook-perf-issue`.
3. **Does it have to be true?** Write the test first. `playbook-tdd`'s neighbour,
   the `tdd` skill, when it is a bug and nothing else.

If none of those hold and the shape is still unclear, `playbook-prototype` exists
to settle it cheaply before the real procedure starts.

## The table

| Playbook | The task | Reach for it when |
| -------- | ------- | ----------------- |
| `playbook-investigation` | a read-only question | you are asking how something works and nothing needs changing |
| `playbook-bug-fix` | a defect | it misbehaves. Reproduce, root-cause, fix, verify |
| `playbook-feature` | new behaviour | the shape is settled and the work is building it |
| `playbook-refactoring` | a behaviour-preserving change | it works and the shape is wrong |
| `playbook-prototype` | a decision between designs | you do not know which shape is right and guessing is expensive |
| `playbook-perf-issue` | a measured slowness | it is slow and you can measure the slowness |
| `playbook-hillclimb` | one number, against a target | the metric is already measured and the job is to move it |
| `playbook-runtime-forensics` | a live symptom | it is broken right now, in a running process |
| `playbook-trace-forensics` | a captured artefact | you have a profile, a heap dump, or a spindump and nobody has read it |
| `playbook-visual-parity` | pixel equivalence | two implementations should look identical and do not |
| `playbook-eval` | comparing candidates | you need to know which of two answers is better, blinded |
| `playbook-authoring-a-skill` | writing a skill | you are editing a `SKILL.md` and the shape is the work |
| `playbook-multi-phase-plan` | work that spans phases | it will not fit in one commit and the plan is the deliverable |
| `playbook-babysit` | driving a PR to merge-ready | a pull request is open and something is outstanding |
| `playbook-shipping` | landing a verified stack | everything is green and the job is getting it in |
| `playbook-opening-a-pr` | the last step of most playbooks | small ordered commits, ready, never draft |
| `playbook-session-pickup` | taking over interrupted work | you are resuming something that was not finished |
| `playbook-pause-safely` | suspending work | you must stop now and the work has to resume cleanly |
| `playbook-autonomous-run` | one task to a condition | it has a checkable exit and you want it driven to it |
| `playbook-orchestrate` | a multi-day programme | one thread owns many units and the units are countable |
| `playbook-autopilot-full` | a queue of PRs to merged | each item has an owner and the queue drains |
| `playbook-autopilot-stack` | one stack for a human to land | the stack is built and verified and a person merges it |

`worktree-cleanup` is the twenty-third and it is not prefixed, because it was
ported before this family existed and it is a maintenance task rather than a
shape of work. It is in the same table under its own name.

## The four that cannot run unattended

`playbook-autonomous-run`, `playbook-orchestrate`, `playbook-autopilot-full` and
`playbook-autopilot-stack` all assume something re-enters a session while it is
working. This host has no such thing: at `v2.0.18` the only `schedule*` symbols
in it are `scheduleReconnect` and `scheduleRows`, both TUI, so there is no
scheduler and no wake primitive.

Read those four as sequences of short resumable runs with their state written to
a file, not as loops. Each one says at the top what was lost. If you were promised
an overnight unattended run, the honest answer is that this host cannot do it and
the procedure is the closest thing that works.

## How to use one

Say which you picked and why, in one line, before the first step. Then open a
`todolist` whose first entries are that playbook's phases, copied, because a
playbook you can navigate away from is a playbook you have not followed.

If the task turns out not to match, say so and switch. Switching early is cheap.
Finishing the wrong playbook is not.
