# PR canvas

Build a visual walkthrough that helps a reviewer understand and inspect a
change: the story first, then a path from each stated requirement or review
question to the exact file and hunk behind it. It covers an existing pull
request the reader wants reviewed and a PR just created in the current
workflow. Once the target and consent are established, both run the same
evidence and publish workflow below.

The delivered thing is an OpenCode artifact, not a file. Publishing returns an
artifact id and a relative URL. A later change updates that same artifact in
place. There is no list: the id `publish` returned is the only handle. Report
the id and the relative URL, never an absolute one, and never claim the page
opened.

## Start

Establish the target and consent before anything is created or published.

1. Consent. A direct request to visually review or understand an identified PR
   or scoped diff is consent. Do not ask again. After a PR is successfully
   created, offer a canvas once with the `question` tool, with **Generate
   canvas** and **Skip**, and only if the reader has not already asked. A skip,
   a dismissal, or no response means no canvas. Explicit requests such as "PR
   with canvas", "PR + canvas", `cPR`, or `!cPR` are consent in either
   workflow. An update to an existing PR is not a newly created PR and does
   not re-trigger the offer. Never publish a canvas before consent.
2. Resolve the subject. A bare number requires a verified repository context:
   never choose a PR from the current branch, recent activity, or repository
   defaults. A user-supplied branch ref resolves to a PR only when it matches
   exactly one open PR in the verified repository. A local diff needs explicit
   base and head. Infer neither, and label it as a local diff without implying
   a GitHub PR exists. Ambiguous means ask for the specific URL or number, or
   the two refs. Closed or merged means state the actual status and ask whether
   they still want it. Never call it open.
3. Pin the analysed head commit where possible, so a PR that moves mid-gather
   is still described by one consistent commit.
4. Read the evidence. Call `tools.spectre.canvas` with `action: "diff"` and the
   resolved PR number or the explicit base and head. No slug: the call returns
   a token, the subject, the totals and the count cross-check, and the evidence
   rows it wrote as scratch files. Read the rows you need with the `read` tool.
   Evidence is structured output on disk, never a prompt payload: never paste a
   diff into a prompt. Routing a large diff through two contexts doubles it
   with nothing counting what was cut.

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
   it. The `Point` union is the rule: a `requirement` needs a source. A
   `change` and a `question` have no source field, so an inference cannot be
   labelled a requirement. If there is no requirement source, do not invent one
   or label an inference as one. Use a plain change explanation or an explicitly
   labeled review question instead.
5. Explain what changes, why it matters to a reviewer, and important cross-file
   relationships. Use a short before/after trace when it makes dense behavior
   easier to predict. Label uncertainty and potential risks as questions or
   hypotheses, never confirmed defects. Report only test and check results that
   were actually observed.
6. If any part of the diff could not be inspected or is too large to explain,
   retain the complete file inventory and name the exact coverage gap. Never
   silently omit files or imply that an incomplete inspection was complete.
   Keep unrelated or sensitive data out of the review.

## Phase B: Publish the walkthrough

Publish with `tools.spectre.canvas` and `{ kind: "pr", token, review }`, where
`token` is the token `diff` returned and `review` is the object Phase A built
(`summary`, `groups`, `points`, `unknowns`). Code owns the diff, the line
numbers, the navigator, the metadata, and the limits — and it validates every
cited path and line against the parsed rows, refusing an unknown path or a
line the file does not have. The model owns the summary, the grouping, the
points, and the unknowns.

The template owns the layout: the metadata header, the at-a-glance summary
position, the review path, the change map, the side-by-side Base/Head diff, and
the limits section. Do not restate it, and do not name a filename, a path, a
launcher, or an HTML tag.

Update with `{ action: "update", id, content }`. The id and URL stay.

## Outputs

The artifact id and the relative URL, the analysed commit, and any material
inspection limitation. Do not claim the walkthrough exists unless the publish
completed.
