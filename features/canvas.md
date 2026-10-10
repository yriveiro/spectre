# Canvas

Status: built. `tools/definitions/canvas/` holds the tool — `index.ts` the
declaration, `parse.ts` the diff parser, `read.ts` the `gh`/`git` reads, and
`store.ts` the artifact store. The two skills are `skills/definitions/canvas/`
and `skills/definitions/pr-canvas/`. `~/Downloads/main-2` holds the source
skills. This is what spectre builds instead of copying them.

## Goal

Two things the repo has no word for.

**A canvas** is a standalone HTML page, self-contained, saved outside the project
so it outlives the session that made it, and opened for a human to read. It is an
artifact, not a chat reply: the user asks again in three turns and gets the same
file, edited in place.

**A PR canvas** is that page aimed at a reviewer, built from a real diff rather
than from a description of one. It has to be inspectable — a reviewer who
disagrees with its summary needs to reach the hunk the summary is about.

The two source skills are `canvas` and `pr-canvas`. Both are correct about what
they produce. Both lean on prose for things that are arithmetic, and that is the
part worth redesigning.

## What pstack does, and the two things it gets by not having code

Read at `~/Downloads/main-2/skills/canvas/SKILL.md` and
`pr-canvas/SKILL.md`. Not paraphrased — the diff counts are reproduced below.

1. **The diff travels as a prompt payload.** `pr-canvas` gathers evidence, then
   hands it to `canvas` as prose. A unified diff crosses two contexts with nothing
   counting what was cut.
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

Four properties of spectre decide the shape. All read at `v2.0.26`. Sources in
the appendix.

1. **A spectre agent can load a second skill.** `packages/core/src/tool/plugin/skill.ts`
   registers `skill` as a **host builtin** with `codemode: false`. It asserts
   permission on `action: "skill", resources: [skill.id]` — a skill *id*, not a
   path — and the body comes from the in-memory registry the plugin populated.
   `packages/core/src/skill.ts` `prepare` touches disk only for a host-internal
   `fs.scan` that lists sibling files. Skills reach the model as `<skill_content>`
   blocks carrying id, name, description. **The `canvas` → `pr-canvas` handoff
   works for a `github:`-installed spectre, not only a local checkout.**
2. **A sibling reference file does not get that.** The one residue of (1): an
   installed plugin's `SKILL.md` lives in the install cache, outside the project,
   and the grant in `agents/index.ts` covers `${dataRoot}/*` only. A
   `references/pr-canvas-template.md` would need a `read` grant for the install
   cache. **The template is merged into the `pr-canvas` body.** Independently: all
   76 definition folders under `skills/definitions/` are exactly `index.ts` +
   `SKILL.md`, `definition.ts` aside, so a third file would be the first of its
   kind.
3. **One tool for a read and a write.** `options.permission` decides only whether
   a tool is *offered*. The call path goes `beforeExecute` straight to
   `executeTool`. A read/write split buys two catalog entries and no safety.
   `worktrees` is the precedent: `list` + `start` + `remove` under one permission.
4. **The data root is already granted.** `agents/index.ts` pushes
   `external_directory`, `read`, `edit` on `${HOME}/.local/share/spectre/*` to
   every registered agent, subagents included, because a subagent never inherits
   its parent's rules. The rule is a prefix match, so adding a `canvases/` level
   needs no grant change. **No permission work.**

Consequence: the port is two skills and one tool, and the tool owns everything
that is arithmetic while the skills own everything that is judgement.

## The shape

**`tools.spectre.canvas`**, one tool, four actions, one
`permission: "canvas"`, `namespace: "spectre"`, `codemode: true`.

| Action | What it owns | Why it is not prose |
| ------ | ------------ | ------------------ |
| `save` | Allocates `<worktree>/canvases/<slug>/` and returns the path. Refuses a taken slug rather than overwriting. | The never-overwrite rule. Seven skills already spell the data-root path inline; `features/data-root.md` exists because that is how it rots. |
| `diff` | `gh` + `git` → subject, changed-file inventory, and **paired rows per file**, each cross-checked against `gh`'s own counts. Writes evidence JSON under the canvas directory. | Line numbers from hunk headers, verified counts, aligned pairs. Measured above: naive counting is silently wrong. |
| `list` | Inventories saved canvases by glob over the tree, each with the `id` and the page's `<title>`. | Ambiguity has to be visible: several rows means several canvases, and the skill asks rather than guessing. |
| `present` | `Bun.spawn` of the platform launcher. Reports `opened` honestly, and never falls back. | One delivery path, so "it opened" is checkable. |

`list` takes no filter. A filtered call would need to decide what a partial match
means — a substring of a title matching three canvases is the ambiguity the skill
is supposed to see — and the reader can already see it in the rows. Filtering in
the tool would move that judgement into a field the skill would have to check
anyway.

**`canvas`** owns the artifact contract: the self-contained page, the in-place
revision policy, when a request is canvas-shaped at all.

**`pr-canvas`** owns consent, subject resolution, evidence *interpretation* —
reviewer-oriented grouping, sourced requirement→hunk links, uncertainty phrased as
questions — and the merged template. It never names a filename or a launcher. It
asks the tool.

### Usage

```js
// A concept. Allocate, write the page at the returned path, present it.
const saved = await tools.spectre.canvas({ action: "save", slug: "tool-registration" })
// -> { status: "saved", id: "tool-registration", directory: "…", canvas: "…/canvas.html" }
// a second call on the same slug returns `taken` with that same path, and overwrites nothing

await tools.spectre.canvas({ action: "present", id: "tool-registration" })
// -> { status: "opened", canvas: "…/canvas.html", deadLinks: [] }
```

The model writes `canvas.html` with `write`, not through a tool argument. A page
of inline JavaScript inside a `Schema.String` is an escaping hazard, and the model
is the only thing that can write a designed page.

```js
// A pull request. Evidence is structured output on disk, never a prompt payload.
// Measured against PR 16; see "Verified after the build".
const d = await tools.spectre.canvas({ action: "diff", pr: 16, slug: "pr-16-check" })
// -> { status: "read", id: "pr-16-check", directory: "…", canvas: "…/canvas.html",
//      subject: { kind: "pull-request", number: 16, repository: "yriveiro/spectre",
//                 state: "merged", headSha: "c002efd4…", … },
//      files: [ { status: "read", index: 1, path: "…/SKILL.md",
//                 additions: 56, deletions: 15, evidence: "…/evidence/files/0001.json" } ],
//      cross: { kind: "matched", parsed: { files: 1, additions: 56, deletions: 15 },
//               reported: { files: 1, additions: 56, deletions: 15 } },
//      problems: [] }
```

`files` carries no `rows`. The rows are in the evidence file each entry names, read
with the `read` tool, and one file is written whole — a 1500-row file loses
nothing. A diff handed over as prose is measured to come back wrong, so the
arithmetic happens here and the interpretation happens in the skill.

### The path

```
~/.local/share/spectre/<worktree-name>/canvases/<slug>/canvas.html
~/.local/share/spectre/<worktree-name>/canvases/<slug>/evidence/index.json
~/.local/share/spectre/<worktree-name>/canvases/<slug>/evidence/files/0001.json
```

Both `features/data-root.md` tests hold: outside the project tree, and outliving
the session.

**The directory is the identity, not the filename.** pstack wrote
`<topic>-<UTC timestamp>-<suffix>.html` into a flat directory and used the
filename stem as the id, because a flat directory has nothing else to identify a
run by. Spectre's convention has a `<slug>` level for free, so the clock leaves
the id: `save` is idempotent on a slug, and a second call returns `taken` with
the existing path rather than a second artifact differing only by a second.

### `<worktree-name>` is a hole in the convention, not a choice here

`arena`, `swarm`, `figure-it-out`, `playbook-eval`, `playbook-orchestrate` and
`playbook-prototype` all write `<worktree-name>/…`, and
`features/data-root.md` documents it. **No file in the repo defines how to derive
it.** This port has to pick something, and picks `basename(project directory)`
falling back to `basename(git rev-parse --show-toplevel)`.

That inherits a real collision: `main` is a common worktree name and two
repositories can each have one, so their canvas stores merge. pstack's
origin-remote namespace (`github-com-y-riveiro-spectre`) does not collide. **The
fix belongs in `features/data-root.md`, in the change that defines the placeholder
for all seven skills, not smuggled in here.** Recorded as a known cost.

## Presentation: OS launcher only

`present` spawns `open` on darwin, `xdg-open` on linux, `start` on win32, and
returns `not-opened` with the saved path and a reason when it cannot. It is a
status rather than a `presented: false` field beside a success, so an outcome
that opened something cannot carry a reason for having not. **No fallback to a
browser tool, ever.**

The reason is ownership and persistence, not availability. `browser.preview` is a
tool spectre does not register and cannot guarantee. Naming it in a skill body
produces the worst failure mode available — the canvas is written and never shown,
which reads as a bug in the code under test. And a canvas is *defined* as
outliving its session, so delivering it through a session-scoped view ties a
persistent artifact to a transient surface and leaves two paths with no rule for
which one proves delivery.

**Not claimed:** whether `browser.preview` is present in TUI sessions. pstack
asserts it may be absent. That was not measured here. The decision stands on the
two reasons above without it.

**Not claimed:** that `start` and `xdg-open` are the right commands everywhere.
Probed on this machine: `start` is absent on darwin, as `xdg-open` is on Linux.
A launcher that is not on `PATH` is a refusal, and the tool must refuse rather
than guess.

## What the tool returns, and what it does not

Every outcome is its own struct in one `Union`, so a field an outcome cannot carry
is not on the type at all.

- `subject` is a two-arm union. The `local-diff` arm **has no `number`, `url`,
  `title`, `author`, or `state`**. The source rule — *label it as a local diff and
  do not imply that a GitHub PR exists* — is the absence of five fields rather than
  a sentence to remember.
- Diff rows are a four-arm union where **the discriminator is the absence**: a
  `removed` row has no `new`, so it cannot name a new-side line number, and there
  is no `"-"` sentinel or `number | null`, because both admit the value the arm
  exists to exclude.
- A binary, submodule, or mode-only change is an `unreadable` arm carrying the
  reason. "No rows" never has to mean "the diff was empty".
- A failed read is reported, never returned as good news — the rule
  `tools/definitions/stack/read.ts` already follows with `threads: -1`.

**The tool does not truncate.** It writes every changed file, whole. A large PR
produces a large evidence tree. The *page* chooses what to render and says which
paths it left out, which is the escape the source template already provides
("identify omitted files/ranges and retain the complete changed-file inventory").

**The tool does not check that the page confessed.** That is the skill's job and
it belongs in the template contract: which paths the page did not render, and
observed checks only — never inferred ones.

## The skills

Both are procedures, so both go in `notALeaf` with **no ripwire map row and no
change to the hub's `none` count**, which is what
`test/skills/ripwire-map.test.ts` asserts.

`canvas` covers, from the source:

- Treat a direct request as the instruction to build and present rather than to plan.
- The self-contained rules: inline CSS and JavaScript, no CDN, no build step, escaped
  content, no `eval`.
- State assumptions visibly and never present mock data as live.
- A meaningful `<title>`, a visible heading, and a stable in-page identifier.
- Iterate **in place** so identity and path stay stable.
- Reopen without regenerating.
- Refuse to guess when several canvases match.

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

Plus, from the template, the merged visual contract: metadata header with grouped
label/value pairs, at-a-glance summary, Overview/Diff tabs, a grouped change map
whose authoritative inventory is the Diff navigator, a requirement→hunk review
path, side-by-side Base/Head with derived line numbers and adjacent annotations,
green/red plus `+`/`−` so colour is not the only cue, secondary explanations
behind a labelled info affordance with nothing important hidden inside it, and
4.5:1 text contrast.

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

**Presenting via `browser.preview`.** Rejected above, on ownership and
persistence rather than availability.

**Keeping the timestamped filename.** Loses the idempotency that a `<slug>` level
gives for free, and keeps the clock in an identifier that is supposed to be
stable across revisions.

## The arena record

Three candidates, three families, from `tools.spectre.routing`: seat 1
`muse-spark-1.3-contributor-free#xhigh`, seat 2 `space-bunny-free#max`, seat 3
`mimo-v2.6-flash-free`. Judge `muse-spark-1.3-contributor-free#high`.

**Base: seat 2.** It is the only candidate that moved the measured failure — line
numbers, count verification, pair alignment — into code, and it chose correctly on
the install-cache residue. Seat 1 returns a raw diff string and leaves pairing to
prose, which is the hope this file measured failing.

**Grafted from seat 1**, all of it prose the typed surface does not supply:

- The consent paragraph and the `question`-tool offer.
- The four subject-resolution rules.
- The observed-checks and omission-confession fields, which seat 2's `Read` arm
  lacks entirely.
- Ambiguity refused at the pick step.

**Rejected.** Seat 2's open question 1 ("how does a spectre agent load a second
skill") — settled above, and its fallback to one skill is moot. Seat 2's printed
`--patch` figures — unanchored counters, unreproducible, replaced by the
re-measurement in this file. Seat 2's `browser.preview` dismissal, which reasoned
from spectre tools reaching the same registry as builtins, a fact that says nothing
about a third-party plugin's tools. The conclusion is kept and seat 1's reasoning
used instead. Seat 2's `path.ts` purity claim, which cannot hold while it spawns
git: the built tool splits the two claims across `store.ts` (paths, allocation,
presentation) and `read.ts` (every `Bun.spawn`), so no module both derives a path
and shells out. Seat 1's carried-over `references/pr-canvas-template.md`, excluded twice
over. Seat 1's registration list, one edit short: `reachable.test.ts` has two
hardcoded sites, not one.

**Seat 3 produced no design.** Named rather than quietly dropped; the arena ran
two candidates plus a judge, and the base was picked on two designs with a rubric
rather than on three by consensus.

## Registration obligations

Every one of these is a place the change fails if it is skipped. All seven are
done.

| File | Edit |
| ---- | ---- |
| `skills/definitions/index.ts` | import both, add both to `definitions`, add both ids to `notALeaf`. Missing the array entry kills the whole set at startup, by `Effect.die`. |
| `skills/definitions/spectre-mode/SKILL.md` | two rows in `## Triggers`, **no** `## Principles index` entry (that index is for leaves). |
| `tools/index.ts` | one `editor.add(canvases(ctx))`. Not a loop: `add` is generic, so a union of two schemas instantiates to neither. |
| `test/tools/reachable.test.ts` | **two** hardcoded sites: the `TOOLS` array, and the import inside the namespace assertion. |
| `features/data-root.md` | a row in "Who writes there": `canvas | canvases/<slug>/`. |
| `features/README.md` | a row in the table. |
| `eval/fixture.ts` | judged rows for both descriptions, held-out. |

**The reachability test greps skill bodies for `tools.spectre.canvas`** with a
word boundary. Renaming the tool without editing a body fails it. Neither skill
auto-invokes, so a skill the trigger table does not name is reachable only by a
reader who asks for it by name.

## What the build changed against this document

Three places where the document was a design and the code had to decide.

1. **`save` allocates rather than only naming a path.** The document says a second
   call "returns `taken` with the existing path". That needs the directory to
   exist, so `save` creates it with two `mkdir` calls — the second non-recursive,
   because `recursive: true` succeeds on an existing directory and would report
   `taken` as `saved`.
2. **`deadLinks` is a same-document check, not an evidence check.** Open question
   4 settled below.
3. **The evidence manifest carries `totals`.** Not in the document's path listing,
   and it is what `index.json` is for: the subject, the cross-check, the totals
   the cross-check compares, and the problems, so a reader has the verdict without
   reading every file.

## Open questions

1. **Where `<worktree-name>` comes from.** `main` collides across repositories.
   The placeholder is undefined repo-wide. The fix belongs in `data-root.md`.
   **Partly settled:** this port picks `basename(project directory)` falling back
   to `basename(git rev-parse --show-toplevel)`, and the collision plus the
   options are now written down in `data-root.md` under "Open" rather than only
   here. Defining the placeholder for all seven skills is still undecided.
2. **Diff size policy.** PR 10 is 164 files and 575 KB. Measure real PR sizes
   against page weight before freezing any cap. The tool does not truncate. The
   page chooses and confesses. **Partly settled:** the tool result is an
   inventory of paths and counts, and the rows live in `evidence/files/`, so a
   large pull request does not arrive as one large tool result. A 1500-row file is
   written whole, which is the behaviour the open question was asking about.
3. **Whether `gh` marks binary, submodule, and mode-only changes** the way `git
   diff` does, and whether `gh`'s `changeType` agrees with its own diff on
   renames. Needs one real PR each, not a guess. **Still open.** The parser reads
   those markers out of the diff text itself rather than asking `gh`, so it does
   not depend on the answer; what stays open is whether a PR whose only marker is
   one `gh` adds and `git diff` omits would read as unreadable when it is not.
4. **Whether the anchor check survives.** **Settled, negatively.** `deadLinks`
   validates `href="#…"` against the `id`s in the same document, which is a check
   that can fail on any page and needs no scheme. The `#f<n>-l<line>` form is not
   implemented, and the shape of this feature emits no such anchors, so validating
   them would be a check that cannot pass.
5. **How large a self-contained page gets before the browser gives up**, and
   whether 4.5:1 actually holds on a generated page. Nothing enforces either.
6. **What "make me a canvas of X" does twice.** `save` is idempotent and returns
   `taken`; how a user asks for a genuinely second version of one slug is undecided.
7. **The hub grows by two rows** into a trigger table already 71% of
   `spectre-mode` and tracked as debt in `TODO.md`. There is no other router.

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

## Appendix: sources

Read at tag `v2.0.26`. A path that does not resolve at the tag is not evidence for
anything here; `AGENTS.md` holds the rule.

| Claim | Where, at the tag |
| ----- | ----------------- |
| `skill` is a host builtin, `codemode: false` | `packages/core/src/tool/plugin/skill.ts:33-42` |
| its permission is on the skill id, not a path | `packages/core/src/tool/plugin/skill.ts:51-53` |
| a skill body comes from the in-memory registry | `packages/core/src/skill.ts:100-104` |
| `prepare` lists sibling files via `fs.scan` | `packages/core/src/skill.ts:55-60` |
| skills reach the model as `<skill_content>` blocks | `packages/core/src/skill.ts:29-42` |
| `permission` is consulted for offer, not at run time | `tools/FOR_AGENTS.md:90-106`, read at `packages/core/src/tool.ts` |

Probed on this machine: `start` is absent on darwin; `Bun.randomUUIDv7`, `Bun.Glob`
and `Bun.which` are functions; `~/.local/share/spectre/main/` is what the
basename derivation resolves to on this checkout.
