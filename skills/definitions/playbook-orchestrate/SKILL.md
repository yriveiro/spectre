# Playbook orchestrate

A standing programme handed to one coordinator: many units, countable, across
days. Every run starts cold and nothing runs while you are out of the room, so a
programme here is a sequence of runs, each reading state and doing one thing.

## Start

The store is `orchestrate/<project-slug>/` under
`~/.local/share/spectre/<worktree-name>/`, the root `arena` already writes to. It is
outside the project directory, so the first write asks for permission, which the `spectre`
agent allows. Every file is plain text.

1. Frame
2. Lay out the store
3. Pilot one unit
4. Scale to a rolling window
5. Drain and land
6. Close

## Phase A: Frame

State the done predicate as something countable — *126 units merged, each
`unit-test-verified` or better in `ledger.tsv`* — and quantify the scope: unit count, rough
effort, expected stacks, wall-clock budget. If one session could finish inside that
budget, stop and run `playbook-autonomous-run`; the store costs more to maintain than the
work it organises.

Name the tracks: `build`, `landing`, and `verification` are common cuts, not a required
shape. By roughly 70% of the budget, stop spawning and land what is verified.

## Phase B: Lay out the store

Every file has one writer; readers aggregate at read time.

- `preferences.md` is the standing-orders register.
  Numbered lines, one constraint each: model policy, stack shape, verification bar,
  forbidden paths, escalation policy. Paste it verbatim into every spawn, and append a
  line whenever you catch yourself restating an instruction.
- `units.tsv`, one row per unit with a header line: `id`, `track`, `state`, `branch`, `pr`,
  `head`, `brief`. Update rows in place. States are `pending`, `briefed`, `running`,
  `landed`, `failed`, `abandoned`, `zombie-reconciled`.
- `ledger.tsv`, one row per verdict: `pr`, `head`, `verdict`, `lanes`, `at`. Verdicts are
  `live-verified`, `unit-test-verified`, `type-check-only`, `verifier-blocked`,
  `verifier-failed`. A new head SHA voids the row, and CI green is an input to a verdict,
  not a verdict.
- `frontier.json`, the computed merge frontier. Compute it in plain git. `generation` increments on every topology change, `order`
  holds the PR numbers bottom-up, `branches` and `heads` are the parallel arrays, and
  `lowestUnmerged` is the one to land next.
- `overview.md`, the durable pull request and issue list. Append, never rewrite.
- `inbox/`, one file per completion: status, branch, head SHA, PR, verdict, deviations.
- `gates.md`, the human's questions: the question, the options, and the default when
  nobody answers.
- `decisions.tsv`, the trail: `at`, `unit`, `head`, `decision`, `why`.
- `status.md`, derived from the two tables at each drain, never hand-maintained and never
  narrated into.

`frontier.json` comes out of git. `git branch --list --format='%(refname:short)
%(objectname)'` gives the candidates and their heads; for every pair, `git
merge-base --is-ancestor <a> <b>` exits 0 when `a` is already inside `b`, so a branch's
parent is the candidate head that is its ancestor and is itself the deepest such head. The
same test against `origin/main` separates *still unmerged* from *already landed*, and
`git log --oneline --graph --all` is the read-back.

## Phase C: Pilot

Push one unit through the whole path — brief, worker, verification, stack entry, ledger row,
merge. The pilot falsifies the brief template, the verify recipe, and the unit size while
that costs one agent instead of fifty. The brief is the product, because a worker cannot
ask a question:

```
GOAL       one sentence, executable by a stranger with no chat access
SCOPE      paths it may write and may not, its branch or worktree
CONTEXT    files, PRs, and upstream reports pasted in full
ACCEPTANCE one checkable criterion per line
VERIFY     the exact command, plus known gotchas
REPORT     status, branch, head SHA, verdict, deviations
STANDING   preferences.md pasted verbatim
```

A field you cannot fill is a unit you have not scoped yet.

## Phase D: Scale

Spawn a rolling window of up to about ten workers in flight. A blocking batch pays the
slowest child of the whole batch, so the cap is a window and not a wall.

`subagent` with `background: true` is the entire parallel capacity, and it is not a
machine: every worker shares this filesystem, so two workers writing the same path
collide and neither of you will be told. Give one writer per branch and one per path, and
treat any path named in two briefs as a scheduling bug
(`principle-separate-before-serializing-shared-state`).

A verifier on a different model family earns its cost only when verification is expensive,
judgment-laden, or wide-blast. A cheap VERIFY stays with the worker.

## Phase E: Drain and land

The inbox is where completions land, because a completion is a queue event and not an
interrupt. Drain in batches: at a track rollup, before a human report, and at a run's start.
Classify every pointer — landed, needs-verify, failed, zombie, noise — write the rows to
`units.tsv` and `ledger.tsv`, regenerate `status.md`, then spawn the next wave in one
message. Never deep-review a diff inside a drain; a completion needing review becomes its
own verification unit.

Landing is continuous, never a terminal phase, and integration starts with the first
verified unit. Only one writer touches topology: one stacker per stack, serialised,
recorded in `preferences.md`. Workers never rebase and never restack.

## Phase F: Close

Drain the final inbox and reconcile every spawned agent to a terminal row. Silently redoing
a missing child's work hides the wasted spend and the gap its result existed to close.
Confirm the predicate on the real artifact and every landed PR's verdict for its current
head SHA, then encode every correction you made twice as a numbered line in
`preferences.md`. Leave the store intact; it is the postmortem for the next run.

## Outputs

The store, intact, and the path to it. At checkpoints and at close: the predicate and the
count against it read from the tables, what each track landed, the frontier with its PRs
and SHAs, what was abandoned, and the open gates.
