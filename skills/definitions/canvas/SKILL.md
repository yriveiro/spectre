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
- A structured engineering workspace with KPI cards, bar/line charts, sortable
  tables, verified code/ADR citations, or live `.spectre/brain` and `ripwire`
  evidence is a `board`. Prefer `board` over `page` whenever structured data
  and diagrams fit the layout, because host code renders the SVG charts,
  tables, and syntax highlighting at zero layout-token cost.
- A custom UI, a concept, or a freeform mock where the custom HTML/CSS/JS
  itself is the point is a `page`.
- One figure and the sentence it carries is a `diagram`.
- Project memory under `.spectre/brain/` uses `brain`, never custom HTML.
- A pull request is `pr-canvas`, not any of the above.

## Report

Write Markdown. Code blocks are syntax-highlighted on the host automatically. A
figure is a ` ```mermaid ` fence inside the prose. Pele renders it to SVG at
publish time with a fullscreen toggle and interactive zoom, pan, copy-source,
and SVG download controls, and code owns the page, the escaping, the headings,
and the table of contents. The model never writes HTML here.

Call `tools.spectre.canvas` with `{ action: "publish", content: { kind:
"report", title, markdown } }`. Report the artifact id and the relative URL the
tool returned.

## Board

Build a structured engineering workspace from typed sections (`kpi`, `chart`,
`table`, `diagram`, `code`, `callout`, `evidence`). Host code verifies any
`at: { path, line?, symbol? }` citation against the worktree, collects local
`brain`, `goal`, or `ripwire` (`ripwire-hotspots`, `ripwire-impact`,
`ripwire-delta`) evidence on demand, and renders the SVG charts, sortable
tables, highlighted code, and interactive Pele diagrams.

Call `tools.spectre.canvas` with `{ action: "publish", content: { kind:
"board", title, summary?, sections } }`. Report the artifact id and the
relative URL.

## Page

Write one complete HTML document with inline CSS and JavaScript. A chart the
page draws loads d3 by referencing `vendor/d3.min.js`. The tool attaches the
installed bundle, so the page never vendors one itself and never loads one from
the network. Every Pele diagram on the page must include a fullscreen toggle
that expands the diagram across the viewport and closes on button click or
`Escape`.

Call `tools.spectre.canvas` with `{ action: "publish", content: { kind: "page",
title, html } }`. Report the artifact id and the relative URL.

## Diagram

Write one Mermaid source and the one-sentence takeaway the reader takes from
it. Pele renders the diagram with a fullscreen toggle. Several figures belong
in a `report`, not here.

Call `tools.spectre.canvas` with `{ action: "publish", content: { kind:
"diagram", title, takeaway, mermaid, caption? } }`. Report the artifact id and
the relative URL.

## Brain

Code composes the entire Brain inspector from `.spectre/brain/`, including the
D3 Connectome, Prompt Cortex, Lineage queue, and Codebase Map. Never write a
custom `page` for project memory.

Call `tools.spectre.canvas` with `{ action: "publish", content: { kind:
"brain", focus? } }`. Report the artifact id and the relative URL.

## Iterate and reopen

- When the reader asks to change a single section, point, group, title, or
  summary of an existing canvas, prefer `{ action: "patch", id, ops }` so you
  do not regenerate the entire document. For a full replacement, use
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
- Generated pages load no external script. A `report`, a `diagram`, a `board`,
  and a PR walkthrough include only the self-contained inline script for Pele
  diagram fullscreen/zoom/pan, code copy, and table sorting.
- A `page` is one document with inline CSS and JavaScript. `data:` images are
  fine. A remote load is a warning the reader sees, so a page that needs the
  network says so on the page.
