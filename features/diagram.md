# Diagram

## What this is

A canvas page that binds data to marks, drawn with a library the page loads from
beside itself. It is the fourth visual surface, after `canvas` (a page), `pr-canvas`
(a diff) and `anatomy` (a machine).

The reader asks for a chart. The session chooses the mark the question needs,
draws it with the fewest elements that carry information, and presents a page
that still opens on a machine with no network.

## Why a library at all, and why that one

Measured, not assumed. d3 7.9.0's UMD bundle is **279,706 bytes**, of which a
plausible subset of eleven modules is roughly 43,000 gzipped. Its per-module UMD
files externalise their siblings, so only the full bundle is one self-contained
file, and a subset needs a rollup run — which the canvas rule forbids as a build
step. So: the whole bundle, vendored.

`deck.gl` was measured and rejected for this surface. Its standalone bundle is
**2,073,497 bytes**, the stripped `@deck.gl/core` + `@deck.gl/layers` pair is
**1,092,771**, WebGL2 is required and its absence throws rather than falling
back, and none of the reader's stated priorities — a tidy mark for the question,
a minimalist page, no redundant data — is a GPU-rendering problem. It is a
different medium. Nothing in this feature depends on it, and its absence from
`package.json` is deliberate rather than an oversight.

## Why the bundle sits beside the page

A canvas opens through `open`, `xdg-open` or `start` on a filesystem path, so
the page runs at `file://`. Three consequences, all measured:

| Question | Answer | Consequence |
| --- | --- | --- |
| Can the page `fetch` a library? | No. A fetch is always CORS-mode. | No runtime loader. |
| Can it `import` one? | No. A module fetch is CORS-mode too. | The UMD build, never `type="module"`. |
| Can it load a classic relative `src`? | Yes. | The bundle goes in `vendor/` beside `canvas.html`. |

The filename carries the version, so a page built against one version keeps
working after the pin moves, and copying the canvas directory copies the library
with it.

## The pin

`scripts/sync-d3.ts` holds two digests and they answer different questions. The
tarball digest says what came off the registry, and the script compares it before
it extracts a single member. The bundle digest says what lands on disk, and a
second run compares against it, so "already vendored" is decidable with no
network at all. The script refuses a destination holding anything else rather
than overwriting it, because overwriting would trade one unexplained file for
another.

Run:

```sh
bun run scripts/sync-d3.ts <canvas-directory>
bun run scripts/sync-d3.ts                      # machine cache, no argument
```

## What the check is

`remoteScripts` in `tools/definitions/canvas/store.ts` reports every script
source that is not a plain relative path — a scheme, a protocol-relative
`//host`, or a root-absolute path — and `present` returns it beside `deadLinks`.

That check exists because the rule it enforces was prose in three files with
nothing behind it. A page loading `https://cdn.jsdelivr.net/npm/d3@latest/` would
have passed every test in this repository, and `@latest` is the tag deck.gl's own
README prescribes, so the mistake is the vendor's documented one.

## The skill

`skills/definitions/diagram/SKILL.md` carries the mark-selection table, the
drawing rules, the list of things to cut rather than add, the layout
coherence rules, and the route to `tools.spectre.prose` for the words on the
page.

The skill sends the words through `tools.spectre.prose`, and it sends the
**strings** rather than the page, for two measured reasons. The tool reads
Markdown, and a canvas is HTML whose inline CSS and JavaScript are full of
semicolons it counts as prose: a 6,574-byte chart page came back with 97
semicolon findings and one passive voice, none of them in its prose. And the
tool reads only inside the project tree, so a canvas path in the data root comes
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

## Open questions

1. **Whether the mark-selection table is complete.** It answers ten question
   shapes. A reader who asks for something outside them gets a judgement call
   from the session rather than a row, which is what this table is for.
2. **Whether `remoteScripts` should fail a page rather than report it.** Today it
   reports, like `deadLinks`. A page with a remote script still opens, because
   `present` reports and the reader decides. Nobody has decided whether the tool
   should refuse to open such a page.
3. **Whether the pin is the only version a canvas may use.** Nothing stops a
   session from naming `d3-8.0.0.min.js` if someone vendored it beside the page
   by another route. The check reads the page, not the pin.
