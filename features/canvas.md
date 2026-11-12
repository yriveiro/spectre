# Canvas

Status: built. `tools/definitions/canvas/` holds the tool — `index.ts` the
declaration and dispatch, `content.ts` the public input/output unions,
`parse.ts` the diff parser, `read.ts` the `gh`/`git` reads, `evidence.ts` the
scratch cache, `compose.ts`/`pr.ts` the page composers, `publish.ts` the
artifact calls, and `d3.ts` the installed bundle. The three skills are
`skills/definitions/canvas/`, `skills/definitions/pr-canvas/`, and
`skills/definitions/diagram/`.

## Goal

Two things the repo has no word for.

**A canvas** is an OpenCode artifact: a page the model publishes and the reader
opens at a relative URL. It is an artifact, not a chat reply: the user asks
again in three turns and gets the same artifact, updated in place.

**A PR canvas** is that page aimed at a reviewer, built from a real diff rather
than from a description of one. It has to be inspectable — a reviewer who
disagrees with its summary needs to reach the hunk the summary is about.

The three source skills are `canvas`, `pr-canvas`, and `diagram`. All three are
correct about what they produce. The old ones leaned on prose for things that
are arithmetic, and that is the part worth redesigning.

## What pstack gets wrong, measured on this repo

Read at `~/Downloads/main-2/skills/canvas/SKILL.md` and
`pr-canvas/SKILL.md`. Not paraphrased — the diff counts are reproduced below.

1. **The diff travels as a prompt payload.** `pr-canvas` gathers evidence, then
   hands it to `canvas` as prose. A unified diff crosses two contexts with
   nothing counting what was cut.
2. **The line numbers are the model's arithmetic.** The template demands line
   numbers "derivable from the hunk headers", counts "verified against the source
   diff", and pairs that are "not a paraphrase, invented sample, or approximate
   illustration". That is a parser specification. pstack implements it by asking a
   model to be careful.

**Measured on this repo, PR 16.** `gh pr view` reports `additions=56`,
`deletions=15`.

```sh
# --patch wraps the diff in a git format-patch mail document whose body is the
# commit message. That prose is full of "-" bullets, and they count as deletions.
gh pr diff 16 --color never --patch | awk '/^\+\+\+/{next} /^\+/{a++} /^---/{next} /^-/{d++} END{print a, d}'
#   56 18      <- wrong by 3 deletions, silently

gh pr diff 16 --color never | awk '/^\+\+\+/{next} /^\+/{a++} /^---/{next} /^-/{d++} END{print a, d}'
#   56 15      <- exact
```

So the failure is not hypothetical and it is not loud. The wrong answer looks
like a slightly bigger diff, and nobody re-derives the numbers on a rendered page.

The anchor matters: **both counters above use `/^-/`, not `/-/`.** An unanchored
deletion filter also counts hunk headers, `index` lines, and prose. One arena
candidate published `49 16` from an unanchored script. Those figures are not
reproducible and are not quoted here. Re-measure before quoting any diff count.

## Mechanism

Three properties of spectre decide the shape.

1. **A spectre agent can load a second skill.** `packages/core/src/tool/plugin/skill.ts`
   registers `skill` as a **host builtin** with `codemode: false`. The `canvas` →
   `pr-canvas` handoff works for a `github:`-installed spectre, not only a local
   checkout.
2. **One tool for a read and a publish.** `options.permission` decides only whether
   a tool is *offered*. The call path goes `beforeExecute` straight to
   `executeTool`. A read/write split buys two catalog entries and no safety.
   `worktrees` is the precedent: `list` + `start` + `remove` under one permission.
3. **The artifact service owns storage.** OpenCode creates, serves, and revises
   artifacts. Spectre owns everything that is judgement or arithmetic — the
   review object, the rendered page, the validated counts — and owns no store,
   no slug index, and no launcher. **No permission work.**

Consequence: the port is three skills and one tool, and the tool owns everything
that is arithmetic while the skills own everything that is judgement.

## The shape

**`tools.spectre.canvas`**, one tool, three actions, one
`permission: "canvas"`, `namespace: "spectre"`, `codemode: true`.

| Action | What it owns | Why it is not prose |
| ------ | ------------ | ------------------ |
| `diff` | `gh` + `git` → subject, changed-file inventory, and **paired rows per file**, each cross-checked against `gh`'s own counts. Writes evidence rows to a scratch cache and returns a content-addressed token. | Line numbers from hunk headers, verified counts, aligned pairs. Measured above: naive counting is silently wrong. |
| `publish` | Creates a new artifact from `content`. A second publish is a second artifact. | One storage owner; the id and relative URL are the host's. |
| `update` | Replaces the whole file map at the same artifact id and URL. It needs the id `publish` returned; there is no list. | Identity is the id, not a slug; an update without one is a refusal. |

`diff` takes no slug. It takes one of `pr`, `url`, or `base` with `head`; four
wrong combinations refuse in `execute` with a named message, and nothing is
inferred.

### The content union

`content` is one of four kinds in `content.ts`, and each kind carries only what
its author must supply:

| Kind | Carries | Why |
| ---- | ------- | --- |
| `page` | `title`, one complete HTML document | The model is the designer; code validates but does not compose |
| `report` | `title`, Markdown; Mermaid fences become static SVG with Pele | Code owns the page, the escaping, the headings, and the table of contents |
| `diagram` | `title`, a takeaway, one Mermaid source, an optional caption | One figure; several figures belong in a `report` |
| `pr` | an evidence `token`, a typed `review` (`summary`, `groups`, `points`, `unknowns`) | Code owns the diff and validates every cited path and line; the title comes from the pull request, not the model |

### Usage

```js
// A report. Markdown in, artifact out.
const r = await tools.spectre.canvas({
  action: "publish",
  content: { kind: "report", title: "Checkout latency, week 45", markdown: "## What changed\n\n…" },
})
// -> { status: "published", id: "art_…", url: "/api/experimental/artifacts/art_…/view/",
//      provider: "local", title: "Checkout latency, week 45", bytes: 21477, warnings: [] }

// A pull request. Evidence is structured output on disk, never a prompt payload.
const d = await tools.spectre.canvas({ action: "diff", pr: 42 })
// -> { status: "read", token: "pr-42-c002efd-6f1a2b", subject: { kind: "pull-request", … },
//      totals: { files: 9, additions: 412, deletions: 96 },
//      cross: { kind: "matched", … }, files: [ … ], warnings: [] }

// …the model reads the rows it needs, then publishes its interpretation:
const p = await tools.spectre.canvas({
  action: "publish",
  content: { kind: "pr", token: d.token, review: { summary: "…", groups: […], points: […], unknowns: […] } },
})

// A later change updates the same artifact in place. Same id, same URL.
await tools.spectre.canvas({ action: "update", id: p.id, content: { … } })
```

The review contract is typed: a `requirement` point needs a `source`. A
`change` and a `question` have no source field, so an inference cannot be
labelled a requirement. Code validates every cited path against the inventory
and every cited line against the parsed rows, and refuses an unknown path or a
line the file does not have.

### The evidence token

The token is derived, never allocated: a readable subject part plus a content
digest over the parsed files. The same diff read twice gives the same token. A
base that moved while the head stayed gives a new digest, so a stale token can
never be republished against a diff the model did not read. The directory is
`<cacheRoot>/<8-hex project digest>/<token>/`, so two repositories cannot
overwrite each other and a token is never a path traversal.

### The flag path

The artifact flag is `experimental.artifacts: true` in `opencode.json` (or
`OPENCODE_FLAGS=artifacts`). With the flag off, `diff` still works and every
publish and update refuses with a message that names the flag. The result URL is
relative. The plugin cannot make it absolute. Never claim the page opened.

d3 is a normal dependency (`^7.9.2`). `bun update d3` updates it. `bun run
d3.check` reports when the installed version is behind the registry. The `page`
arm references `vendor/d3.min.js`. The tool attaches the installed bundle. Pele
handles structural diagrams. d3 handles the statistical charts Pele does not
cover.

## What the tool returns, and what it does not

Every outcome is its own struct in one `Union`, so a field an outcome cannot carry
is not on the type at all.

- `subject` is a two-arm union. The `local-diff` arm **has no `number`, `url`,
  `title`, `author`, or `state`**. The source rule — *label it as a local diff and
  do not imply that a GitHub PR exists* — is the absence of five fields rather than
  a sentence to remember.
- A binary, submodule, or mode-only change is an `unreadable` arm carrying the
  reason. "No rows" never has to mean "the diff was empty".
- A failed read is reported, never returned as good news.

**The tool does not truncate.** It reads every changed file, whole. The *page*
chooses what to render and says which paths it left out, which is the escape the
template already provides ("identify omitted files/ranges and retain the complete
changed-file inventory").

**The tool does not check that the page confessed.** That is the skill's job and
it belongs in the review: which paths the page did not render, and observed
checks only — never inferred ones.

A warning is data, not a failure: the publish still returns an id, and the page
states what the warning says. A `mismatched` count cross-check is printed in the
limits section with both numbers, not a block.

## The skills

All three are procedures, so all three go in `notALeaf` with **no ripwire map row
and no change to the hub's `none` count**, which is what
`test/skills/ripwire-map.test.ts` asserts.

`canvas` covers kind selection (`report` for prose with figures, `page` for a
designed document, `diagram` for one figure), the publish/update calls, the
in-place revision policy, the flag-off refusal, and the sandbox contract.

`pr-canvas` carries four things from the source that a typed tool surface does not
give for free, and they are the reason the skill exists at all:

1. **Consent.** A direct request to review an identified PR is consent; do not ask
   again. After a PR is created, offer once via the `question` tool with **Generate
   canvas** and **Skip**, and only if the user has not already asked. A skip, a
   dismissal, or silence means no canvas. `cPR` / `!cPR` is consent either way. An
   update to an existing PR is not a new PR and does not re-trigger the offer.
2. **Subject resolution.** A bare number needs verified repository context. A
   branch ref resolves to a PR only when it matches exactly one open PR. A local
   diff needs explicit base and head — nothing is inferred. Ambiguous → ask.
   Closed or merged → state the actual status and ask. Never call it open.
3. **The pin.** Pin the analysed head commit where possible, so a PR that moves
   mid-gather is still described by one consistent commit.
4. **Evidence and limits.**
   - Every changed path accounted for.
   - Stated intent kept distinct from observed implementation.
   - Uncertainty phrased as a question, never a confirmed defect.
   - Only check results actually observed.
   - Every coverage gap named.

`diagram` owns mark selection and the two arms: Mermaid source for structure
(Pele renders static SVG at publish time), d3 in a `page` for statistics. It
keeps the drawing rules that survive (one takeaway, axis zero for bars, one
accent, label the ends, no legend repeating the axis, two measures two panels,
no decoration on data) and the prose gate, which checks the reader-visible
strings, not the page.

## Alternatives, and why each lost

**A faithful port — two skills, no tool.** `pstack` with paths repointed, `gh`
shelled out from prose, the diff handed over as a payload. This is what a "port"
looks like and it loses on the measurement above: the silent 56/18. It also
re-learns what `tools.spectre.stack` already learned about `gh` and state
normalisation — a second, prose-shaped copy that will diverge, which is
`principle-hygiene`'s exact failure. And `test/tools/reachable.test.ts` carries
the note that `worktrees` once shipped "correct, tested, and unreachable": a port
with no mechanism has correctness only where a model remembers to be careful.

**One skill with the PR phases inlined.** Loses on routing: one description would
carry both "draw me a page about the auth flow" and "review PR 42", the regression
`skills/FOR_AGENTS.md` measures. The handoff is available and costs one `skill`
call.

**A read tool and a write tool.** Explicitly forbidden, and re-argued in
`tools/FOR_AGENTS.md`: `permission` is a visibility label, never consulted at run
time, so the split buys two catalog entries and no safety.

**Presenting via an OS launcher.** Rejected: it is a second delivery path with a
second claim, and a canvas is *defined* as outliving its session, so delivering
it through a session-scoped view ties a persistent artifact to a transient
surface. The brief forbids the "opened" claim. The skills report the id and the
relative URL instead.

**Keeping the timestamped filename and the slug index.** Loses the identity the
artifact id gives for free, and keeps the clock in an identifier that is supposed
to be stable across revisions. A second publish is a second artifact. `update` is
the only in-place path.

## Deleted

- `store.ts` in full: the canvas tree, the slug allocation, the `taken` refusal,
  the OS launcher, the title extraction, and the evidence writer. Nothing
  replaces the store. Artifacts own identity, storage, serving, and revision.
- `scripts/sync-d3.ts` and the vendored bundle: there is no page that loads a
  library from beside itself. d3 is a normal dependency. The `page` arm
  references `vendor/d3.min.js` and the tool attaches the installed bundle.
- `save`, `list`, `present` and their outputs. No allocation, no inventory, no
  launcher, no `opened` claim.

## Open questions

1. **Whether `gh` marks binary, submodule, and mode-only changes** the way `git
   diff` does, and whether `gh`'s `changeType` agrees with its own diff on
   renames. Needs one real PR each, not a guess. **Still open.** The parser reads
   those markers out of the diff text itself rather than asking `gh`, so it does
   not depend on the answer; what stays open is whether a PR whose only marker is
   one `gh` adds and `git diff` omits would read as unreadable when it is not.
2. **How large a self-contained page gets before the artifact view gives up.**
   `bytes` is reported; no threshold is enforced because nobody has measured the
   view's ceiling. The old feature's largest measured diff was 575 KB, which
   becomes roughly 0.9 MB of HTML.
3. **Is `experimental.artifacts` on by default on the channel most users run?**
   The flag resolves on for `local` and `dev` builds and off otherwise; the
   design assumes off and refuses with the flag named. Re-check at each OpenCode
   bump.
4. **Does a client surface for artifacts exist?** At v2.2.7 no TUI or GUI source
   reads `Artifact.Info`; only the schema, core, server, protocol, and client do.
   The view route is the delivery path. If a client surface lands, the skill's
   "report the id and the relative URL" sentence should name it instead of
   leaving the reader to find one.
5. **Should `report` accept a `files` map** for a page that genuinely needs a
   second asset? Today the answer is no, one file, which is what makes the
   external-load check total. A file map would move the check from "no external
   loads" to "every load is in the map".
6. **Should `mismatched` be a refusal on a page that claims verified counts?**
   It is a warning today because the page prints both numbers and says they
   disagree. If a reader reports being misled, this flips.

## Verified after the build

Re-measured on this repo, PR 16, because the whole reason the tool exists is a
count that comes back wrong quietly.

```sh
gh pr view 16 --json additions,deletions        # {"additions":56,"deletions":15}
gh pr diff 16 --color never --patch | awk ...   # 56 18   <- the measured failure
gh pr diff 16 --color never | awk ...           # 56 15   <- exact
```

Through the tool, on the same PR:

```
cross: {"kind":"matched","parsed":{"files":1,"additions":56,"deletions":15},
                       "reported":{"files":1,"additions":56,"deletions":15}}
```

The parser reaches `gh`'s own numbers on files, additions and deletions, and
refuses `--patch` output outright rather than counting a commit message's `-`
bullets as deletions. `gh pr view` reports one changed file for PR 16 and the
diff carries one `diff --git` header, so `files` agreeing at 1 is agreement rather
than a coincidence of two wrong counts.
