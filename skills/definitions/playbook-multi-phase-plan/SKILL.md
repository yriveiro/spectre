# Playbook multi-phase plan

Write the plan for a change too big for one pull request, and stop. The plan is
the deliverable. You do not implement it.

## Start

1. Size it
2. Settle the open questions
3. Explore
4. Write
5. Check
6. Hand back

## Phase A: Size it

When the change is one or two files with an obvious approach, skip this
playbook. What earns a plan is a change that spans several pull
requests, has an order they must land in, or carries a question only a run can
answer.

## Phase B: Settle the open questions

Settle every open question by prototyping it before you write a word of the
plan. Each prototype is a real run on a real branch, not a design document.

Keep the branch, the SHA, and whatever the run produced. They go in the evidence
appendix, and they turn a claim into something checkable.

Ask the user only about a product or preference call no run can settle. Offer
options rather than a recommendation with the decision already made.

## Phase C: Explore

Explore in subagents, and pick each one's model with `tools.spectre.routing({})`
rather than naming one. Never write a model id into a plan: by the time the plan
is executed the allowlist will have moved and the plan will be wrong.

Each subagent returns file pointers, the conventions in force, the test commands
and the entry points. No inlined dumps and no prose summary of a file the plan
could just point at. A plan that quotes code goes stale the first time the file
moves; one that names the file does not.

## Phase D: Write

Write the plan to a file. Unless the user names a path, put it under `docs/`.
Keep the headings and the order below: one section per pull request, and one
pull request is one change carrying its own evidence.

Write under `technical-writing`, then pass it through `unslop`. The body is one
mode throughout, a how-to; explanation and reference go in the appendices. Each
heading states the task or the finding rather than naming a category. No long
dashes, and no colon in the middle of a sentence.

The plan opens under ten lines: what changes, for whom, the rule the programme
enforces, and the pull request ids in order. Then `How to read this`, which says
that one box is one unit of work checked only when its evidence exists (a file, a
log line, a screenshot, a test run, a SHA), and that a nested box is a step of
the box above it.

Each pull request section carries:

- **Depends on.** The pull request id, or None.
- **Files.** Bullets of edit, create, delete.
- **Build.** One change, naming the symbol and the file.
- **You see.** One observable result, with the exact log line or screen state.
- **Verify, unit.** The test file and the case it gains, and the command.
- **Verify, live.** Lanes at the head, each with a scenario, the screenshot it
  saves, and its pass predicate.
- **Verify, perf.** The metric, the probe, the trunk baseline measured first, and
  the rule with the number that fails.
- **Review gate**, when the change touches an interaction.
- **Merge.** What has to be true first.

Then the appendices: prototype evidence with branches and SHAs, the alternatives
rejected and why, the risks with the pull request each lands in, and the reading
list.

**The verification rule.** Tests alone are not sufficient verification. A pull
request is verified only when its unit, live, and perf boxes are all checked, and
the live block is mandatory. A test proves a function; it does not prove the
thing a user does.

The live block is a set of lanes at the head, each one a subagent whose model
comes from `tools.spectre.routing({})`, each driving the real surface rather
than reading the diff. One lane is the regression lane against the trunk: run
the same load-bearing scenario at the trunk and at the head. If the trunk does
not have the feature, the lane records that and gates the behaviour the diff
adds plus the end state the user is waiting for, instead of inventing a trunk
result. Never claim a ratio between unlike scenarios.

The perf block is dual-sided: both the trunk and the head must produce the named
metric. Where the trunk lacks the feature, also isolate the work the diff adds
and set an absolute budget for it, alongside the end state the user waits for.

A pull request that changes an interaction is review-gated: screenshots, a short
video, and the user's review in chat before merge. One that changes no
interaction writes that it is not review-gated, with no boxes under it.

## Phase E: Check

Read the plan back yourself, and it is not optional: every placeholder filled,
every heading stating a task or a finding, every pull request with a
verification block naming a real run and its outcome, every dependency
consistent with the order the ids are listed in.

One claim in a plan does have an instrument. `tools.spectre.comments` takes the
paths the plan names and returns the comments and suppressions in each, so a
wrong path comes back empty instead of being asserted. Run it over the files the
plan points at: an unexpected empty is a wrong path.

## Phase F: Hand back

Post the plan path and what the prototypes proved, then stop. Execution starts
on the user's explicit go, as a fresh pass per pull request: build it, then
`playbook-opening-a-pr` for each.

Say what stayed unproven. An open question the prototypes did not settle is
part of the deliverable, not a gap for the executor to find.

## Outputs

The plan path, the pull request ids with their dependencies and the review-gated
set, what the prototypes proved and what stayed open, and the Phase E result.
