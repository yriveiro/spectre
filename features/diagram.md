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

The lexical half of ASD-STE100 is off while `spectre.jsonc` names no dictionary,
so that gate covers the structural rules only. Uncomment the `dictionary` key
and point it at an export to turn the word list on. Nothing else changes.

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
