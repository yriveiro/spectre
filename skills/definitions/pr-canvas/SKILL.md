# PR canvas

Build a visual guide that helps a reviewer understand and inspect a change, as
a standalone page they can open: the story first, then a path from each stated
requirement or review question to the exact file and hunk behind it. It covers
an existing pull request the reader wants reviewed and a PR just created in the
current workflow. Once the target and consent are established, both run the
same evidence and canvas workflow below.

## Start

Establish the target and consent before anything is created or saved.

1. Consent. A direct request to visually review or understand an identified PR
   or scoped diff is consent. Do not ask again. After a PR is successfully
   created, offer a canvas once with the `question` tool, with **Generate
   canvas** and **Skip**, and only if the reader has not already asked. A skip,
   a dismissal, or no response means no canvas. Explicit requests such as "PR
   with canvas", "PR + canvas", `cPR`, or `!cPR` are consent in either
   workflow. An update to an existing PR is not a newly created PR and does
   not re-trigger the offer. Never create or save a canvas before consent.
2. Resolve the subject. A bare number requires a verified repository context.
   never choose a PR from the current branch, recent activity, or repository
   defaults. A user-supplied branch ref resolves to a PR only when it matches
   exactly one open PR in the verified repository. A local diff needs explicit
   base and head. Infer neither, and label it as a local diff without implying
   a GitHub PR exists. Ambiguous means ask for the specific URL or number, or
   the two refs. Closed or merged means state the actual status and ask whether
   they still want it. Never call it open.
3. Pin the analysed head commit where possible, so a PR that moves mid-gather
   is still described by one consistent commit.
4. Read the evidence. Call `tools.spectre.canvas({ action: "diff", ... })` with
   the resolved PR number or the explicit base and head, plus a slug prefixed
   `pr-<number>-` for a GitHub PR. The tool returns the subject, the
   changed-file inventory with verified counts, and the evidence files it
   wrote. Read those files. Evidence is structured output, never a prompt
   payload: never paste a diff into a prompt, and never load `canvas` as a
   skill to hand a payload over. Routing a large diff through two contexts
   doubles it with nothing counting what was cut. Loading `canvas` through the
   host `skill` tool, which takes a skill id, is available. Carrying a megabyte
   of diff through a prompt is what is refused, not the capability.

## Phase A: Interpret the evidence

The tool pairs the lines and checks the counts. Judgement of what they mean is
this phase.

1. Inspect the complete changed-file inventory and the actual diff. Check
   surrounding code when needed to explain behavior and how changed components
   interact. The title or PR description alone is not evidence of what the code
   does.
2. Record the source and review identity: PR URL and number (or explicit local
   base and head), title, repository, state, base and head refs, analysed head
   commit, and author or change counts when verified and useful. Keep the PR
   description's stated intent distinct from observed implementation.
3. Account for every changed path. Assign files to reviewer-oriented groups
   adapted to the change, such as core behavior, integration and data flow,
   configuration and dependencies, and tests and documentation. Keep generated,
   formatting-only, renamed, and other mechanical files visible in a compact
   group rather than letting them obscure behavior changes.
4. For each stated requirement or acceptance criterion with an accessible
   source, record its source and the exact changed file and hunk that addresses
   it. If there is no requirement source, do not invent one or label an
   inference as one. Use a plain change explanation or an explicitly labeled
   review question instead.
5. Explain what changes, why it matters to a reviewer, and important cross-file
   relationships. Use a short before/after trace when it makes dense behavior
   easier to predict. Label uncertainty and potential risks as questions or
   hypotheses, not confirmed defects. Report only test and check results that
   were actually observed.
6. If any part of the diff could not be inspected or is too large to explain,
   retain the complete file inventory and name the exact coverage gap. Never
   silently omit files or imply that an incomplete inspection was complete.
   Keep unrelated or sensitive data out of the canvas.

## Phase B: Compose the page

The contract below is the output, merged from the template. There is no
separate reference file. Omit sections with no evidence rather than filling
them with generic filler.

- Metadata header with grouped label/value pairs: people and revision
  (author, base, head, analysed commit) and change size (file count, additions,
  deletions), verified values only. Never a single inline ribbon, and never
  the same numbers as competing cards.
- At-a-glance summary: a brief, evidence-based explanation of the change and
  its purpose, keeping verified implementation separate from author-stated
  intent. The main reviewer focus, not an approval or risk verdict.
- Overview and Diff tabs, prominent and directly navigable. When sourced
  requirements form a clear review sequence, let that ordered list be the
  review path, with each item linked to its file or hunk. Do not repeat it in
  a second card.
- Grouped change map of the important areas and their relationships, linking
  to the files in Diff. The Diff navigator is the authoritative complete
  inventory, not a repeated card.
- Requirement-to-hunk review path: each sourced requirement shown briefly,
  linked to its source and to the changed lines implementing it. No inferred
  motivation quoted as a requirement.
- Side-by-side Base/Head Diff with old and new line numbers derived from the
  hunk headers, aligned pairs, and annotations adjacent to the lines they
  explain. Green/red plus `+`/`-` markers so colour is never the only cue.
  A file navigator covering every changed path, with the selected file
  apparent. Binary, submodule, generated, mode-only, or otherwise non-text
  changes shown by verified status and available metadata, with no
  manufactured text. Unavailable content marked clearly.
- Diagrams only when a verified flow or cross-file relationship is materially
  clearer drawn: an inline self-contained static SVG, no CDN runtime. A simple
  attributed inline-SVG fallback when no renderer is available.
- Secondary explanations, such as what Base/Head mean, behind a labelled info  affordance that opens on click or keyboard, dismisses, and stays readable on
  narrow screens. Never hide the takeaway, a requirement, changed code, a
  limitation, or the next action inside one. Never rely on hover alone.
- Visible focus states, links recognisable without colour alone, and at least
  4.5:1 text contrast on actual pairs. Comfortable type, wrapping long paths
  or a horizontal scroll for the diff on narrow screens.
- Default to a calm, mostly colorless app interface: one rounded review surface,
  one visible selected nav state, dotted or broken-line panel boundaries. Treat
  orange and yellow as rare attention cues — a question needing review, a
  targeted hunk, an active focus indicator — never the base surface, dominant
  text, or fill for every requirement.
- Self-contained like any canvas: inline CSS and JavaScript, no CDN, no build
  step, escaped content, no `eval`.
- Say which paths the page did not render. The tool does not truncate and
  does not check that the page confessed. This page does both, in its limits
  section, alongside the analysed commit, observed checks only, and every
  material unknown.

## Phase C: Write and present

Write `canvas.html` into the canvas directory the `diff` call allocated, with
the `write` tool, then present it with
`tools.spectre.canvas({ action: "present", id })`. Follow `canvas`'s
in-place rule from here: later changes edit that file, and reopening presents
it rather than regenerating it.

## Outputs

The presented canvas, and a short report beside it: the canvas location, the
PR URL (or local base and head), the analysed commit, and any material
inspection limitation. Do not claim the canvas exists unless the write and the
present both completed.
