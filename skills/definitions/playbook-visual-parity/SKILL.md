# Playbook visual-parity

Move a component to a new implementation and prove it renders the same. The baseline
is the specification, you do not touch it, and equivalence is settled by an image
diff rather than by your eye.

Driving a real UI is the job, and the instruments for it are in the session: the
`playwright` tools load a page, click, type, resize and read the accessibility
tree, and the browser tool opens and focuses a tab so a screenshot can be shown to
the person who asked.

A native iOS target needs a simulator as its harness. If this machine has none,
say so and agree the harness before writing the migration, because a parity claim
you cannot reproduce is not a parity claim.

## Start

1. Capture the baseline
2. State the anti-shortcuts
3. Migrate one component
4. Diff and investigate
5. Report per component

## Phase A: Capture the baseline

Before any migration, build the harness that screenshots the current component
across its states: default, hover, focus, disabled, empty, loading, error, and the
narrow and wide viewport. When you are matching two implementations rather than
replacing one, capture the target the same way, state by state, so both sides are
described by the same script.

Write it so the run is one command. Drive the page with `playwright`, set the
viewport, disable animation and the caret, wait for fonts and for network idle, and
screenshot to a fixed path per state. Anything nondeterministic in that sequence
becomes a false diff on every later run.

Commit the baseline PNGs. They are the specification, and a baseline that lives only
in a local scratch directory cannot be reviewed, diffed in a pull request, or
reproduced on another machine.

No baseline, no parity claim. This is a blocking prerequisite, not a follow-up task.

## Phase B: State the anti-shortcuts

Write these down before you start. Each is easy under deadline pressure and each
destroys the value of the exercise:

- **No harness edits after the baseline exists.** Not a tolerance, not a mask, not a
  clip region added to make one component pass.
- **No baseline tampering.** Never regenerate a baseline from the new implementation
  and call it parity.
- **No restructuring to make a diff pass.** Rewriting a component until it matches
  the reference is a redesign, and it needs its own review.

If the baseline looks wrong, stop and ask. The reference may genuinely be wrong, and
that is a decision for whoever owns the design, made deliberately. Silently
correcting it inside a migration is how a parity run becomes unrevivable.

## Phase C: Migrate one component at a time

Shared primitives first, as a blocking phase. A button that does not match makes
every component that contains a button unmatchable, and the diff stops carrying
information.

After that, one owner per component, and the owners work in parallel in their own
worktrees, each opened by that owner as its first act — this session stays on
main, because `tools.spectre.worktrees` moves the caller in and a caller can only
own one. Two migrations cannot collide on the same file. A component that two
people are editing at once produces a parity failure whose cause is the merge, not
the pixels.

## Phase D: Diff and investigate

For each component, screenshot the new implementation through the same harness, in
the same states, and diff it against the baseline PNGs. A nonzero diff is a failure.
There is no threshold to tune, because a threshold is where parity quietly stops
being parity.

When the diff is nonzero, find the pixel delta and name it. Antialiasing on a text
baseline, a one-pixel border, a different font fallback, a shadow blur radius — these
are four different bugs and only the last one is a real defect. Read the diff image;
do not infer the cause from a summary line.

Then fix the implementation and diff again. Re-running the harness is cheap, so
iterate to zero rather than batching a run per component per attempt.

## Phase E: Report per component

Parity is claimed per component, not per run. A PR that touches five components
carries five baseline diffs, each with a path, and a reader can check any one of
them without rerunning the harness.

## Outputs

- The components migrated, and the diff result for each: zero, or the named cause of
  a nonzero diff.
- The baseline location, in the tree, and the one command that regenerates the
  screenshots.
- The harness path, so the next person can add a state rather than rewrite it.
- What is left, and which components are still unverified.
- A plain statement if a target could not be captured at all, such as a simulator
  that does not exist on this machine.
