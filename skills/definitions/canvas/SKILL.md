# Canvas

A canvas is an OpenCode artifact, not a file. Publishing returns an artifact
id and a relative URL. The reader asks again in three turns and the same
artifact is updated in place. There is no save, no list, and no present: the
id `publish` returned is the only handle, and nothing here opens a page. Report
the id and the relative URL, never an absolute one, and never claim the page
opened.

A request to review a pull request visually is not this. That is `pr-canvas`,
which owns PR identity, evidence, and the review layout. This skill never names
a PR number.

A page that binds data to marks is `diagram`, which owns the choice of mark and
the Mermaid source or d3 chart a figure is drawn from. Load it when the answer
is a drawing rather than a report or a designed UI.

## Pick the kind

- A run report, an audit, a findings page, an analysis — anything that is prose
  with figures in it — is a `report`.
- A designed UI, a concept, a mock, an interface the reader clicks through in
  their head — anything where the layout itself is the point — is a `page`.
- One figure and the sentence it carries is a `diagram`.
- A pull request is `pr-canvas`, not any of the above.

## Report

Write Markdown. A figure is a ` ```mermaid ` fence inside the prose; Pele
renders it to static SVG at publish time, and code owns the page, the escaping,
the headings, and the table of contents. The model never writes HTML here.

Call `tools.spectre.canvas` with `{ action: "publish", content: { kind:
"report", title, markdown } }`. Report the artifact id and the relative URL the
tool returned.

## Page

Write one complete HTML document with inline CSS and JavaScript. A chart the
page draws loads d3 by referencing `vendor/d3.min.js`; the tool attaches the
installed bundle, so the page never vendors one itself and never loads one from
the network.

Call `tools.spectre.canvas` with `{ action: "publish", content: { kind: "page",
title, html } }`. Report the artifact id and the relative URL.

## Diagram

Write one Mermaid source and the one-sentence takeaway the reader takes from
it. Several figures belong in a `report`, not here.

Call `tools.spectre.canvas` with `{ action: "publish", content: { kind:
"diagram", title, takeaway, mermaid, caption? } }`. Report the artifact id and
the relative URL.

## Iterate and reopen

- When the reader asks to change a canvas, publish the full new content with
  `{ action: "update", id, content }`. The id and the URL stay; a second
  `publish` is a second artifact, never an edit.
- If the id is lost, ask for it or publish a new artifact. Do not invent a
  list: there is none, and guessing an id publishes onto somebody else's page.
- If the reader asks to reopen a canvas, give them the id and URL again. Do not
  regenerate it just to reopen it.
- If several canvases could match and the intended one cannot be inferred, ask
  which canvas to use before changing anything.

## The flag is off

With `experimental.artifacts` off, `diff` still works and every publish and
update refuses with a message that names the flag. Report the refusal and the
config line (`experimental.artifacts: true` in `opencode.json`, or
`OPENCODE_FLAGS=artifacts`). Do not fall back to a file: a file is a second
store, and this skill owns no store.

## The sandbox

- No `localStorage`, no cookies, no forms, no popups, no same-origin fetch.
- Generated pages ship no JavaScript. A `report`, a `diagram`, and a PR
  walkthrough are static documents.
- A `page` is one document with inline CSS and JavaScript. `data:` images are
  fine. A remote load is a warning the reader sees, so a page that needs the
  network says so on the page.
