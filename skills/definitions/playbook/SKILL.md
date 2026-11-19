# Playbook

Twenty-five procedures, one per shape of task (`24` `playbook-*` skills plus `worktree-cleanup`). This file states the selection rule and the wake contract. Call `tools.spectre.skills({ category: "playbook" })` to list all twenty-five procedures or `tools.spectre.skills({ query, category: "playbook" })` to match one before calling `skill({ id })`.

`principle-*` tells you how to hold yourself while you work. Playbooks tell you what to do and in what order. A principle has no phases. A playbook does. If a request is small enough that the order does not matter, skip playbooks and apply a principle or nothing.

## The rule

**Match the shape of the task, not its topic.** "The login page is slow" is a perf task whichever feature it touches. "Rewrite the auth module" is a refactor even though it touches login. Picking the wrong playbook runs a confident sequence of the wrong steps.

Three questions force a choice over a bare request:

1. **Is anything wrong?** Reproduce before you change anything. Load `playbook-bug-fix`.
2. **Is it too slow?** Measure before you change anything. Load `playbook-perf-issue`.
3. **Does a defect have a cheap local test target?** Write the failing test first with `tdd`.

If none of those holds and the shape stays unclear, load `playbook-prototype` to settle it cheaply before the real procedure starts.

## Long programmes and the native wake

`playbook-orchestrate`, `playbook-autopilot-full` and `playbook-autopilot-stack`
are long programmes, and a session is one unit of one. Each writes its objective,
its queue and its progress to a file. On OpenCode 2.2.1+ with
`experimental.schedules`, create an audit schedule with
`tools.opencode.schedule_create` and the programme wakes itself. Without schedules,
ask for the next unit.

`playbook-autonomous-run` is the continuous case. Armed with `/drive`, the built-in
goal loop re-enters the session until the exit predicate is met, and `/goal pause`
stops it. `/babysit` is the same loop with a pull-request stack as the predicate.

## How to use one

Say which you picked and why, in one line, before the first step. Then open a
`todolist` whose first entries are that playbook's phases, copied, because a
playbook you can navigate away from is a playbook you have not followed.

If the task turns out not to match, say so and switch. Switching early is cheap.
Finishing the wrong playbook is not.
