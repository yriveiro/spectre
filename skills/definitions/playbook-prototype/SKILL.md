# Playbook Prototype

Build the thing you are going to throw away, in order to make one decision.
Speed over polish, no planning, no tests, no abstractions, and the code is not the
deliverable. This is the one procedure where the usual "smallest change" and the
usual verification bar both invert, because the rigour belongs in the choice and
not in the artifact.

`principle-exhaust-the-design-space` states when a decision with no precedent
needs competitors built rather than guessed. This is how you run the experiment
once that has already fired.

## Start

Open a `todolist` with one entry per phase before building anything.

1. Decide
2. Reference
3. Build
4. Compare
5. Hand over

## Phase A: Decide

Name the decision the prototype exists to make, in one sentence. Which layout.
Which interaction. Which density. For an empirical fork, which behaviour, which
timing, which approach. Write it down, because the artifact gets judged against
this sentence and not against your taste.

No decision means no prototype. Two designs that are both fine is not a
decision either; find the one that is not fine and prototype against that. When
the decision does not exist yet, route to `playbook-feature`.

Decide what evidence would settle it. A screenshot, a timing number, a count of
misclicks, a rendered page. Without that, "I like it better" is the output and
you have written nothing worth keeping.

## Phase B: Reference

Only when the design space is actually open. In-repo prior art comes from
`ripwire.exemplar`, which returns the best instance already here for the role
you are filling, and reading it costs one call. Outside the repo, `websearch`
and `webfetch` reach real examples. Summarize what you found as a short set of
directions and let the person pick before anything is built.

Skip this phase when the direction is already set, and say in the note that it
was set rather than quietly skipping it.

## Phase C: Build

Throwaway means throwaway. Build in a scratch directory outside the project:
`~/.local/share/spectre/<worktree-name>/prototype-<slug>/`. Not the production
source, and not `/tmp` — the artifact has to survive the session to be looked at
twice, and `/tmp` does not promise that.

For a visual decision, the lightest thing that renders the idea: plain HTML, CSS
and JavaScript, dependencies off a CDN, a dev server with hot reload. For a
behavioural or timing decision, the smallest script that exercises the question.
No production framework, no tests, no abstraction that only the prototype needs.
A prototype that imports the real module is no longer isolated, and the point of
it is that you are allowed to be wrong cheaply.

## Phase D: Compare

When there is more than one variant, put them behind a single switcher — a
button, a keypress — each labelled, and move between them without a reload.
That is the design-space principle made cheap, and a comparison you have to
re-run twice by hand stops being a comparison.

Drive each variant with the `playwright` tools and take one screenshot per
variant with `tools.playwright.browser_take_screenshot`. Read the console with
`browser_console_messages`, because a variant that looks right and throws is not
a variant. For a behavioural or timing decision the observation is the test, so
log the timings or print the output; an assertion is not what you are looking for
here, and writing one puts you back in a testing mindset the prototype exists to
avoid.

Throw an approach away and try another rather than polishing the first one. The
second variant is usually the one that turns out to be right, and it only gets
written if you left room for it.

## Phase E: Hand over

Present the variants, the evidence beside each, the tradeoffs, and one
recommendation. Say plainly that the artifact is throwaway and give its path, so
nobody later mistakes it for code that escaped a scratch directory.

The chosen direction goes to `architect` for the shape, then to
`playbook-feature` for the real build. The prototype is the input to that, not a
shortcut around it.

## Outputs

The variants explored, the evidence for each — screenshots for a visual
decision, observed output or timings for a behavioural one — the tradeoffs, your
recommendation, and the scratch path.
