# Canvas

Turn a requested concept into a standalone HTML page that is easy to review in
a browser, identify later, and refine in follow-up prompts. A canvas is a saved
artifact, not a transient chat reply: the reader asks again in three turns and
gets the same file, edited in place.

A request to review a pull request visually is not this. That is `pr-canvas`,
which owns PR identity, evidence, and the review layout. This skill never names
a PR number.

## Create a canvas

1. Treat a direct request to make a canvas or represent something as a UI as the
   instruction to produce and present the artifact. Do not stop after describing
   a plan or asking the reader to open a file.
2. Allocate the canvas directory with the tool. Pick a descriptive,
   filesystem-safe slug for the concept and call
   `tools.spectre.canvas({ action: "save", slug })`. The tool refuses a taken
   slug rather than overwriting; on `taken`, pick a different slug. Never
   overwrite an existing canvas when creating a new one.
3. Build a complete, responsive HTML document for the requested concept. Make
   the most useful information and actions apparent in the UI, with coherent
   hierarchy, realistic content, readable typography, and thoughtful spacing.
   Add interactions when they help explain or explore the concept. State
   assumptions visibly when the prompt leaves important details unspecified;
   do not invent real-world facts or imply mock data is live.
4. Keep the artifact self-contained: inline CSS and JavaScript, no CDN, no
   build step, no external image dependency, and no project-wide configuration
   change. Use semantic HTML, accessible labels and contrast, responsive
   layouts, and escape inserted content. Do not use `eval` or execute content
   from the canvas data.
5. Include a meaningful `<title>` and a visible canvas heading. Add a stable
   canvas identifier in the document so the artifact remains identifiable if it
   is copied or reopened.
6. Write `canvas.html` at the path the tool returned, with the `write` tool,
   then present it with `tools.spectre.canvas({ action: "present", id })`.

## Iterate and reopen

- When the reader asks to change a canvas, identify the intended one from the
  conversation or from `tools.spectre.canvas({ action: "list" })`. Edit that
  file in place so its identity and path remain stable. Do not make a duplicate
  unless the reader asks for a new version or a separate canvas.
- After edits, present the updated file again with
  `tools.spectre.canvas({ action: "present", id })`.
- If the reader asks to reopen a canvas, locate it the same way and present
  the saved HTML. Do not regenerate it just to reopen it.
- If several canvases could match and the intended one cannot be inferred, ask
  which canvas to use before changing or reopening one.

## Present the canvas

Presentation goes through the operating system's launcher, via
`tools.spectre.canvas({ action: "present", id })`, and nothing else. Do not
use a browser tool for canvas presentation, even if one appears in the catalog:
a canvas outlives its session, so delivering it through a session-scoped view
ties a persistent artifact to a transient surface, and a page that is written
but never shown reads as a bug in the code under test. If the tool reports it
could not open the page, report the failure and give the saved path; do not
fall back.
