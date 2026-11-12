# Diagram

## What this is

A canvas artifact that binds data to marks. The reader asks for a chart. The
session chooses the mark the question needs, draws it with the fewest elements
that carry information, and publishes an artifact that still opens on a machine
with no network.

## The split

The question decides the arm, and the skill's mark-selection table is the
router:

- A structural drawing (flow, sequence, state, class, ER, gantt, timeline, pie,
  quadrant, mindmap) is Mermaid. It rides in a `report` when the reader needs
  prose around it, or in a `diagram` when one figure and its takeaway are the
  whole answer. Pele renders the Mermaid to static SVG at publish time, so no
  artifact carries a Mermaid runtime, a CDN, or a hand-drawn SVG unless Mermaid
  cannot express the drawing at all.
- A statistical chart (line, bar, scatter, histogram, box, stacked bar) is d3
  in a `page`. The page references `vendor/d3.min.js` and the tool attaches the
  installed bundle at publish time.

If Pele refuses a Mermaid type, the skill says so and falls back to a `page`
with a static inline SVG. Mermaid and CDNs are never loaded at view time.

## Why d3 is a dependency and not a bundle

d3 is a normal dependency (`^7.9.2`). `bun update d3` is the update path. `bun
run d3.check` reports when the installed version is behind the registry. That
is why the pin is a caret, not an exact: a page asset is not a host contract,
and an artifact keeps the bytes it was built with.

The `page` arm references `vendor/d3.min.js`. The tool attaches the installed
bundle, so the page never vendors one itself. Deleting the old
`scripts/sync-d3.ts` and the vendored copy removed the pin, the digest, the
cache, and the test that kept them in sync — a second distribution channel for
a library the package manager already distributes.

Pele handles the structural diagrams. d3 handles the statistical charts Pele
does not cover: marks Mermaid's types cannot express.

## Why the bundle is attached, not loaded

A generated page is one file. Every `src`, every `href` that loads, and every
CSS `url(...)` must be inline or `data:`. Anything else is refused at publish
time, because there is nothing beside the page for a relative `src` to load and
any external load is a dependency the reader's network has to satisfy.

That check exists because the rule it enforces was prose in three files with
nothing behind it. A page loading `https://cdn.jsdelivr.net/npm/d3@latest/`
would have passed every test in this repository, and `@latest` is the tag
deck.gl's own README prescribes, so the mistake is the vendor's documented one.

`deck.gl` was measured and rejected for this surface. Its standalone bundle is
**2,073,497 bytes**, the stripped `@deck.gl/core` + `@deck.gl/layers` pair is
**1,092,771**, WebGL2 is required and its absence throws rather than falling
back, and none of the reader's stated priorities — a tidy mark for the question,
a minimalist page, no redundant data — is a GPU-rendering problem. It is a
different medium. Nothing in this feature depends on it, and its absence from
`package.json` is deliberate rather than an oversight.

## The skill

`skills/definitions/diagram/SKILL.md` carries the mark-selection table, the
drawing rules, the list of things to cut rather than add, the layout
coherence rules, and the route to `tools.spectre.prose` for the words on the
page.

The skill sends the words through `tools.spectre.prose`, and it sends the
**strings** rather than the page, for two measured reasons. The tool reads
Markdown, and a page is HTML whose inline CSS and JavaScript are full of
semicolons it counts as prose: a 6,574-byte chart page came back with 97
semicolon findings and one passive voice, none of them in its prose. And the
tool reads only inside the project tree, so a canvas path in the data root came
back `empty` with `scanned: 0` and no error, which reads as a clean pass.

The first version of that instruction pointed at the canvas path and was wrong on
both counts. The section above now points at the strings instead.

The lexical half runs only when a `spectre.jsonc` names a dictionary. Both the
global `~/.config/opencode/spectre.jsonc` and the project file resolve it, and
`tools/index.ts` reads the config once, when OpenCode calls the plugin's
`effect`, so a session started before the file existed keeps reporting the
structural half alone.

### What the lexical half actually is

Not a lint. `scanTarget` takes `(asked, directory, disabled)` and no dictionary
(`prose/index.ts:273`), and `rulings` returns an empty array unless `words` is
supplied. So a scan of files **cannot** emit a lexical finding in this version,
and the repo's zero lexical findings held before any dictionary existed, because
nothing looked. A caller checks vocabulary by naming the words.

Two further readings, both measured against a 2,198-entry Issue 9 export:

| Word | Verdict |
| --- | --- |
| `utilize` | `not-approved (v)`, alternatives `USE(v)` |
| `run` | `not-approved (v)`, alternatives `OPERATE(v)` |
| `check` | `approved (n)` |
| `customize`, `initialize`, `visualize`, `abbreviation` | `unknown` |

`unknown` is the documented reading for a word with no entry, not a violation.
The export holds the headwords the standard rules on rather than the whole
lexicon, so a word it does not list is invisible to the gate. Enforcing
vocabulary on a whole page means extracting its words and passing them as
`words`; the tool does not do that for you.

### `empty` and `scanned` do not mean what they look like

`scanTarget` increments `scanned` only for a file that produced findings, and
sets `empty` when the whole target produced none. So `scanned: 0` with
`empty: [target]` means **the target was read and was clean**, not that it was
skipped. Both numbers are floors over files with findings, not a file count.

## The page checks

The `page` arm is the one arm where the model authors HTML, so the tool checks
what code cannot compose: external loads are refusals (the artifact is one
file), unsafe link schemes are refusals, outbound links are warnings, and a dead
in-page anchor warns. On a generated page (`report`, `pr`, `diagram`) a dead
anchor is a refusal instead, because a composer bug must not ship.

## Open questions

1. **Whether the mark-selection table is complete.** It answers ten question
   shapes. A reader who asks for something outside them gets a judgement call
   from the session rather than a row, which is what this table is for.
2. **Whether Pele's Mermaid coverage reaches every mark readers ask for.**
   Probe before promising: `xychart` covers line and bar, `pie` covers parts of
   a whole. Anything Pele refuses falls back to a `page` with static inline SVG.
3. **How large a generated page gets before the artifact view degrades.** No
   threshold is enforced because nobody measured the view's ceiling.
4. **Whether `report` should accept a `files` map** for a page that genuinely
   needs a second asset. Today the answer is no, one file, which is what makes
   the external-load check total.
