# The brain (`.spectre/brain`)

Status: designed, not built. Every signature below is a sketch with
`not implemented` bodies; the shapes are the contract and the bodies are Phase D.

## Goal

A coding agent forgets everything between sessions. `AGENTS.md` says what is true
about a project and rots. `ripwire` says what the code currently does and knows
nothing about why. The brain is the third thing: **what the code cannot show**.

It holds the feature map of whatever project spectre runs in — which surfaces are
one feature, why a decision was made, what bit someone last month — as plain
files inside the project, so it is diffed, reviewed and reverted with everything
else. One agent, `mnemonic`, owns it.

The neuro vocabulary is load-bearing and exact, because it is what makes the
shape falsifiable: **a neuron is a claim, a synapse is a dated relation between
claims, and neither is ever rewritten.**

## Usage

Three call sites, before any type is written.

```ts
// 1. A session needs something the code cannot say. The headline and the edge
//    arrive; the body is one Read away, so only what decides the answer is
//    ever in context.
const hit = await tools.spectre.brain({
  action: "recall",
  query: "why does the routing tool read spectre.jsonc",
})
hit.claims[0].id     // "0199b6…" — Read `.spectre/brain/neurons/0199b6….md`, cite it
hit.edges[0].why     // and the reason those two claims belong together
hit.problems         // present when the budget clipped the answer, or a note is unreadable

// 2. mnemonic, after a diff lands: a fact the repo does not contain.
await tools.spectre.brain({
  action: "assert",
  kind: "gotcha",
  subject: ["tools/definitions/canvas/store.ts"],
  claim: "A canvas is never overwritten: save allocates the directory, the write tool writes the page.",
})

// 3. A fact that replaced another fact. An edge, not an edit.
await tools.spectre.brain({
  action: "supersede",
  from: "0199b6…",
  to: "0199c2…",
  why: "the flat-notes design was replaced by the ledger",
})
```

Usage forced four decisions, and each of them closed a door:

- **`recall` returns headlines and edges, never a body.** One `Read` is cheaper
  than carrying prose, and it bounds the budget whatever a note's length.
- **`subject` is paths, and evidence is derived.** `assert` takes what the claim
  is about and the tool reports what git says about those paths. A model cannot
  type its own evidence.
- **`supersede` is an action, not a field.** It needs an ordering check and a
  `why`, and folding it into `relate` would put those fields on relations that
  cannot carry them.
- **`problems` is on every answer.** A clipped or partly-unreadable brain is an
  answer that says so, in the shape, not a silent gap.

## What a neuron and a synapse are

| | on disk | minted by | mutability |
| --- | --- | --- | --- |
| **neuron** | `.spectre/brain/neurons/<ulid>.md` | `assert` | never rewritten, never deleted |
| **synapse** | one line of `.spectre/brain/synapses.ndjson` | `relate`, `supersede`, `demote` | never edited, never deleted |

A neuron is a **claim**: a `kind` (`feature`, `gotcha`, `decision`, `constraint`,
`lesson`), one sentence of `claim`, the `subject` paths it is about, a ULID minted
once with `Bun.randomUUIDv7`, and frontmatter carrying its own schema version.

A synapse is a **dated relation with a reason and an optional end**: `relates`,
`supersedes`, `contradicts`, `derived-from`, `demoted`. `why` is mandatory on
every one. `until` is how forgetting is recorded.

**A feature is not a folder.** It is a claim of kind `feature` whose `subject`
lists two or more surfaces, plus the edges that join them. Nothing on disk is
named after a feature, which is a real ergonomic cost: `ls` shows ULIDs. It is
accepted, because the second representation of the same fact is the index that
goes stale, and `recall` is the reader.

Frontmatter edges were the obvious home and are wrong: a per-edge `until` inside
frontmatter can only be recorded by rewriting the note that carries it. That is
A-MEM's neighbour-rewrite drift (arXiv:2502.12110) and Zep's unscoped similarity
recall (arXiv:2501.13956) arriving through the front door.

## Shapes and signatures

Bodies are `not implemented` on purpose. Tricky logic is marked where it is
tricky, not written.

```ts
// tools/definitions/brain/neuron.ts — a claim. Owns NoteFrontmatter (private).
export type Claim = {
  readonly id: string;
  readonly kind: "feature" | "gotcha" | "decision" | "constraint" | "lesson";
  readonly claim: string;
  readonly subject: ReadonlyArray<string>;
  readonly at: string;
  readonly path: string; // AbsolutePath, branded, for the one Read
};

// Accepts unknown fields and migrates on read. Never rejects an older note.
export const parse = (text: string): Effect<Claim> => not implemented;

export const render = (claim: Claim): string => not implemented;
```

```ts
// tools/definitions/brain/ledger.ts — the substrate. The only module that writes.
export type Edge = {
  readonly kind: "relates" | "supersedes" | "contradicts" | "derived-from" | "demoted";
  readonly from: string;
  readonly to: string | null; // null only on `demoted`
  readonly why: string;
  readonly at: string;
  readonly until: string | null; // forgetting, never deletion
};

// tmp in the same directory → flush → atomic rename. Bun has no atomic overwrite.
const write = (path: AbsolutePath, contents: string): Effect<void> => not implemented;

// Content-compared on (kind, from, to, why): a second identical run writes
// nothing and `git diff` is empty.
export const append = (edge: Edge): Effect<boolean> => not implemented;

export const mint = (draft: Draft): Effect<Claim> => not implemented;

export const read = (): Effect<{ claims: ReadonlyArray<Claim>; edges: ReadonlyArray<Edge> }> =>
  not implemented;

// Drops edges whose `until` has passed. Demotion is a filter, not a rewrite.
export const live = (edges: ReadonlyArray<Edge>): ReadonlyArray<Edge> => not implemented;
```

```ts
// tools/definitions/brain/recall.ts — a question. One exported function.
export type Answer = {
  readonly claims: ReadonlyArray<Claim>; // headline only; path, never body
  readonly edges: ReadonlyArray<Edge>;
  readonly sources: ReadonlyArray<string>;
  readonly problems: ReadonlyArray<string>;
  readonly clipped: boolean;
};

// Tricky: BM25 over headline fields, then personalised PageRank from the query's
// subjects, two hops, damping 0.85. Relevance is the score; recency is a
// tiebreak on equal relevance and never a decay factor.
export const recall = (input: {
  readonly claims: ReadonlyArray<Claim>;
  readonly edges: ReadonlyArray<Edge>;
  readonly query: string;
  readonly budget: number;
}): Effect<Answer> => not implemented;
```

```ts
// tools/definitions/brain/evidence.ts — the anti-fabrication seam.
// git log --numstat over the subject paths. Counts, not prose: the model does not
// get to write down its own evidence. Accepts the duplication of a few lines of
// history's git parsing; extracting a shared git reader is a separate change that
// would touch history's callers.
// `directory` is explicit because cwd is not the project directory: a serving
// process chdirs to the home directory (`packages/cli/src/server-process.ts` at
// v2.0.26), so a seam that trusted cwd would report git's opinion of the wrong
// repository — the one fabrication it exists to prevent.
export const evidence = (
  directory: string,
  subject: ReadonlyArray<string>,
): Effect<EvidenceReport> => not implemented;
// EvidenceReport = { rows, missing, problems }. `missing` is a path that is not
// in the repository. `problems` is git failing to answer at all — no repository,
// off PATH, timed out — which is the case where a filesystem check is the only
// oracle left for invariant 9.
```

```ts
// tools/definitions/brain/inject.ts — what a session may see without asking.
export const attach = (ctx: Plugin.Context): Effect<void> => not implemented;
// Registers session.hook("context"), appends ONE <UNTRUSTED_CONTENT> part capped
// at 600 tokens, keyed on the ledger's mtime so an unchanged brain costs nothing.
// Filters on event.agent: the hook fires for subagent sessions too, so mnemonic
// is skipped (it is about to hold the whole ledger) and so is any agent the
// session spawned, because 600 tokens in every arena seat is the dilution
// skills/FOR_AGENTS.md already measured against this repo.
```

```ts
// tools/definitions/brain/index.ts — the tool.
export const Action = Schema.Union([Recall, Assert, Relate, Supersede, Demote]);
// One permission label, every refusal inside execute. Read and write are one tool
// because options.permission is a visibility label and a split buys two catalog
// entries and no safety (tools/FOR_AGENTS.md).
export const brain = (ctx: Plugin.Context): Tool.Info<typeof Action, typeof Answered> =>
  not implemented;
```

`options: { namespace: "spectre", codemode: true, pinned: true, permission: "brain" }`.
Numeric fields are `Schema.Number`, never `Schema.Int`. No `Int`, `Trim`,
`NonEmptyString`, `URL`, `Natural` or brand anywhere in either schema.

## Module map

```
tools/definitions/brain/
  index.ts     the tool. Five actions, five structs in one Union, one permission.
  neuron.ts    a claim.      NoteFrontmatter (private) → Claim (exported).
  ledger.ts    the substrate. Two write primitives, tmp→rename, ULIDs,
               content compare, `live`. The only module that writes.
  recall.ts    a question.   Glob, BM25, two-hop spread, budget, `problems`.
  evidence.ts  an objection. git over the subject paths. Read-only.
  inject.ts    a session.    context hook, <UNTRUSTED_CONTENT>, mtime cache key.
agents/definitions/mnemonic.ts        flat .ts, following agents/definitions/sicko.ts.
agents/index.ts                       invariant 8: { action: "edit", resource: ".spectre/brain/*", effect: "deny" }
                                      on every agent, then { action: "edit", resource: ".spectre/brain/*", effect: "allow" }
                                      pushed after it for mnemonic only.
skills/definitions/playbook-brain/    SKILL.md + index.ts, in notALeaf.
features/brain.md                     this file.
```

No module is named for a phase. `recall.ts` and `inject.ts` both need the ledger
and neither re-reads the wire shape, because `ledger.ts` is the only reader and
hands out domain types. The budget constant lives in `recall.ts` and `inject.ts`
receives the value `recall` already computed rather than defining its own.

## What OpenCode already does

Read at tag `v2.0.26`, not on `dev`.

- **`tool.execute.after` fires after every tool call** and its mutated `result` is
  what returns (`packages/core/src/tool.ts:140-155`). `execute.before` is the only
  hook in the system that can fail a call.
- **A per-agent writable directory enforced by `permissions` is shipped
  precedent — with one condition this design initially got wrong.** OpenCode's
  bundled `plan` plugin denies `edit` on `*` and allows one absolute path, pushed
  through `editor.update` (`packages/core/src/plugin/plan.ts:38-41`). That works
  because `~/.opencode/plan` is **outside** the project.
- **A permission resource for a project-local file is project-relative, not
  absolute.** `FileAccess.resolve` returns
  `resource: path.relative(location.directory, absolute)` for a target inside the
  project, and the absolute path only when the target is outside it — which is
  also the only case that additionally asks for `external_directory`
  (`packages/core/src/file-access.ts:100-120`). So `write` and `edit` request
  `action: "edit", resources: [".spectre/brain/…"]`, and an absolute-path rule
  matches nothing. The rule has to be the relative glob.
- **The matcher is `findLast` over the flattened ruleset**
  (`packages/core/src/permission.ts`, `evaluate`), and `denied()` short-circuits
  on any resource evaluating to `deny`. So order inside one agent's array is the
  whole mechanism: deny first, allow last. `agents/index.ts` already pushes onto
  `agent.permissions` in order, so the two rules land in the order they are
  written.
- **`read` is a separate action** (`file-access.ts:155`), asserted by
  `authorizeRead`. A brain the reader cannot read is useless, so the deny is on
  `edit` alone.
- **`session.hook("context")` fires for subagent sessions too.** A subagent is a
  real session — `sessions.create({parentID})` then `sessions.prompt`
  (`packages/core/src/tool/plugin/subagent.ts:185-215`) — which reaches
  `modelRequest.primary`, and the event carries the child's `agent`
  (`packages/core/src/session/model-request.ts:419`). `event.system`,
  `event.messages` and `event.tools` are mutable, and the `plan` plugin splices a
  `Message.user(text)` in.
- **There is no session start or end hook.** Lifecycle is read-only bus events
  (`session.created`, `session.compaction.*`). "What changed since last time"
  therefore has nothing to hang on, which is why nothing here is hook-driven.
- **`ctx.storage` is the designed home for cross-session plugin memory** and it is
  the data dir, which this feature is forbidden to use. It is also the reason the
  brain is project-local rather than per-plugin: the knowledge is about *this
  project*, and `ctx.location.directory` is what scopes it.
- **`Agent.Info` has no `tools` field.** A narrower catalog comes from the
  `permissions` ruleset, last-match-wins.

## The playbook

`skills/definitions/playbook-brain/`, registered in `notALeaf`, one skill and not
two. `skills/FOR_AGENTS.md` measures a leaf at about 3 points of held-out
`bm25-full` hit@1, and a `brain` skill beside a `playbook-brain` would be two
near-synonym routers for one job. The body is the procedure:

1. **Recall first, always.** One `tools.spectre.brain({action:"recall"})` before
   answering a question about this project's history, decisions or gotchas.
2. **Assert only what the code cannot show.** A why, a gotcha, a lesson, a
   constraint. Never re-derivable layout, never a symbol index — `ripwire` owns
   that and is better at it. The test: would `ripwire` answer this?
3. **Relate when two surfaces are one feature.** `subject` carries the paths, and
   the tool derives the evidence.
4. **Supersede, never edit. Demote, never delete.** Both are edges with a `why`,
   and `git log` is the recovery path.
5. **Hand a sweep to `mnemonic`.** Seeding, reconciling and pruning are a
   300-note scan. Doing that in the session that asked the question evicts the
   question. A session asserts and relates. `mnemonic` curates.
6. **Stop when `ripwire` is the right instrument.** Callers, blast radius,
   history and co-change already have a tool, a measurement and a map row.

Its description names the moment, because the description is the routing surface:
*"the question is 'what do we already know about this project', or a fact landed
that the repo does not contain"* — with the literal tool name in it, or
`test/tools/reachable.test.ts` fails.

## Invariants

Each one is a test, and each has a home.

1. No neuron is ever rewritten or deleted. `ledger.ts` exposes `mint` and
   `append` and nothing else that writes.
2. A second identical run produces an empty `git diff`. Content compare in
   `append`, ULID minted once in `mint`.
3. Every mutation is tmp → flush → rename. Bun has no atomic overwrite.
4. Every edge carries a `why`. It is a required field, not a lint.
5. Forgetting is an edge with `until`. There is no delete path.
6. Nothing derived is committed. The frontmatter **is** the index, so no index
   exists to go stale. Any future generated artifact must be rebuildable from
   these files by a checked-in command, or it must not exist.
7. Injected memory is wrapped in `<UNTRUSTED_CONTENT>` and capped at 600 tokens.
   Model-written claims are hints, never instructions.
8. Only `mnemonic` may **write** `.spectre/brain`. The rule is the relative glob
   `.spectre/brain/*`: `edit` denied on every agent, allowed on `mnemonic` pushed
   last, from `agents/index.ts` beside the data-root rules. `read` is denied to
   nobody — a brain the reader cannot read is not a memory.
9. `assert` refuses a `subject` path that does not exist, inside `execute` and
   not in the schema. A claim with no reachable subject is a hallucinated feature,
   and this is the one check that earns a runtime test.
10. The brain is not a code index. A fact `ripwire` can answer is not a neuron.

## Cold start

The requirement the shape above does not answer: spectre is installed for the
first time, `.spectre/brain` does not exist, and `recall` has nothing to return.
Nobody has asked a question yet, so nothing has triggered a write.

**The seed is a `mnemonic` sweep with a fixed order, a hard cap, and a marker.
It is not a session side effect, and it is not a hook.**

### Stage 0 — interview the repo, not the reader

**This stage is `create-verification-skill` Phase A, called rather than
restated.** That skill already asks the five questions that matter — surface, run,
drive, observe, isolate — from the checkout, asking the reader only what cannot
be observed. The brain needs four of the five and answers them differently:

| Phase A asks | The brain asks instead |
| --- | --- |
| **Surface.** What does a user touch? | **Shape.** What are the top-level domains, and which one is primary? |
| **Run.** How does it start? | **Shape**, plus: where does state live, and is any of it already written down? |
| **Drive.** How can an agent touch it? | **Entry.** Which files does a newcomer open first, per the declarations? |
| **Observe.** What can a run capture? | **Ground.** What does the repo already declare about itself? |
| **Isolate.** Can two instances coexist? | **Couple.** Which files change together, per git? |

Reusing the skill rather than restating it is the point: `skills/FOR_AGENTS.md`
puts a near-duplicate leaf at about 3 points of held-out routing, and the reader
who needs both already has both. What is borrowed is the *discipline* — answer
from the checkout, ask only what you cannot observe, and fix a base that does not
build before describing it.

Concretely, one `Bun.Glob` pass plus the first heading of each: `AGENTS.md`,
`README*`, `CONTRIBUTING*`, `docs/`, `features/`, `TODO*`, `CHANGELOG*`, an ADR
directory, `package.json`'s description, CI workflow names, top-level test
directory names.

### Stage 1 — name and group, bounded

`mnemonic` reads the stage-0 inventory and the top of the map `ripwire` already
produced, then mints claims: one `feature` per coherent area with `subject`
listing its paths, plus the `constraint` and `decision` claims the declarations
already state. It stops at a claim cap or a token cap, whichever comes first.

The cap is small on purpose. The seed's job is to make the **first recall**
useful, not to be complete. Aider budgets a repo map at ~1k tokens and OpenHands
injects ~6k characters. A seed that tries to hold the whole project reproduces
exactly the `AGENTS.md` rot the research found — bloat, stale claims, and
contradictions between nested files that the resolver settles arbitrarily.

### Stage 2 — falsify the seed, on the way in

Every `assert` returns the derived evidence for its `subject`: co-change count,
last touched, churn. A feature whose members never co-change and never share a
symbol is a grouping the model got wrong, and it is visible **in the return value
of the call that created it**. `mnemonic` supersedes it or re-asserts it.

This is where the graft from seat 1 earns its keep, and it is aimed at the least
trustworthy write the system makes. A cold seed is a guess about a codebase
nobody read yet, so it is the one write that arrives with a measurement beside it
instead of a promise.

**The unit of rigor is the feature, not the sentence.** Borrowed from
`maintain-verification-skill`, and it changes the shape of what gets minted: one
`feature` claim per feature with its sub-points in the body, never one claim per
sub-point. Thirty features is thirty claims. A seed that mints a claim per bullet
produces a hundred, none of which is independently falsifiable, and `recall`
returns a fragment instead of a feature.

### Stage 3 — mark it seeded, and say which of three words it is

One claim of kind `decision` recording the seed: the repo's HEAD sha, the claim
count, the date. That marker is what makes "do not re-seed" a fact rather than a
convention.

It is **not** invariant 2, and the earlier draft of this document was wrong about
that. `mint` mints a fresh ULID on every call, so a second seed at the same HEAD
writes N more notes rather than producing an empty diff. Invariant 2 covers an
identical `append`, not an identical sweep. The seed's idempotence comes from
reading the marker and not sweeping when the HEAD is unchanged.

The seed ends in one of three named words, borrowed from
`maintain-verification-skill` Phase A, because a seed that reports "done" without
one of them is the thing that skill exists to prevent:

- **cold.** The seed ran and found nothing worth keeping. No claims written. This
  is a real outcome, not a failure: a repo with no declarations and no coupling
  has no features to name, and saying so is the honest answer.
- **seeded.** Claims were minted and every one of them came back with evidence.
- **partial.** Some claims were kept and some were refused for want of evidence.
  The refusals are named in the return value.

A fourth word is not available. "Seeded" with unnamed refusals is the failure mode
this whole stage exists to catch.

### The trigger, and what it costs the first session

Not on plugin load: that is startup cost and a side effect nobody asked for. Not
on the first `recall` either, because a `recall` that quietly starts work is a
surprise. `recall` on a cold brain returns `claims: []`,
`problems: ["cold: 0 claims"]`, and the injected part carries the same fact in
one line — so the model knows in the turn it would have spent, and playbook step
1 hands the sweep to `mnemonic`. The brain is discoverable without paying for it.

The honest weakness: **stage 2 has no signal on a repository with no git history,
or one whose files are genuinely uncoupled.** Twenty independent utilities have
no co-change signal, so on those projects the seed is a guess and the evidence
comes back empty. The seed still beats nothing, and the answer says it was a
guess rather than pretending otherwise.

## What came from the verification-skill pair

`pstack/skills/create-verification-skill` builds the thing this design is trying
to generalise, for one repo: a project-local feature map, maintained, with a
procedure per feature. Both skills are already ported here, so this section
records what was taken and what was not.

Taken:

- **Interview the repo, not the reader.** Answer what you can observe, ask only
  what you cannot, and fix a base that does not build before describing it. Stage
  0 is now that skill's Phase A called rather than restated.
- **One file per feature, three to five to begin.** The claim cap in stage 1 is
  this number, and it is the reason the seed is a seed and not a wiki.
- **The unit of rigor is the feature, not the sentence.** One claim per feature,
  sub-points in the body.
- **Three named outcomes** — clean, changed, blocked — become cold, seeded,
  partial for the seed. A procedure that cannot report "I found nothing" reports
  nothing honestly.
- **A procedure that was never executed is a draft.** The smallest slice in "First
  thing to build" is the seed run once against this repo.

Not taken:

- **A separate feature-map directory with a README index.** The brain's
  frontmatter *is* the index, and invariant 6 forbids the second representation
  that goes stale.
- **Fixed four-section feature files.** `Sub-features`, `How to get to it`,
  `Driving it with <harness>`, `Gotchas` are a verification contract. A neuron
  is not required to be driveable, and a section that is always "n/a" is reader
  load with no information in it. `Gotchas` survives as a claim `kind`, because
  that one earns its place on any project.
- **The maintenance loop.** Not in scope, and the reason is in the open
  questions: the live pass has no analogue here, and a brain that is only seeded
  decays. Designing that pass before the seed has a measured hit rate is building
  upkeep for something whose value is unknown.

## Rationale

**Arena record.** Two seats, both read end to end. Seat 2 shipped the base: a
neuron is an immutable claim and a synapse is an append-only ledger line, which is
the only shape that makes a relation a **dated, supersedable thing** — which is
what "memory with relations" asks for. Seat 1 shipped the opposite and better
argument: **the map is a derived view and nothing derived is committed**, so it
cannot drift. Seat 1 also wanted a hook-captured observation trace. That graft was
rejected, because git history and `ripwire.cochange` already carry the same
evidence with zero new state, and a trace that duplicates both is a second source
of truth.

Grafted from seat 1:

- **Evidence is derived, never prose.** `assert` takes `subject` paths and
  `evidence.ts` reports what git says about them. This is the answer to "the
  model is wrong": the error is on the record and the record carries a
  measurement next to it.
- **The eviction rule as a stated invariant with a test**, not a habit.

Seat 1's `mnemonic`-as-a-capture-agent seam was rejected in favour of seat 2's
permissions seam, because the capture is the model, and a ruleset entry is not a
sentence.

**Convergence, which is the strongest signal here:** both seats independently
chose a flat `agents/definitions/mnemonic.ts` over the folder shape
`AGENTS.md` states, because that is what the tree is (`spectre.ts`, `sicko.ts`).
The doc is corrected in the same change rather than the files migrated.

**Rejected, with the reason.** Frontmatter `related:` — a per-edge `until` can
only be recorded by rewriting a note. `bun:sqlite` — a binary in git, `-wal`
sidecars, and the model cannot hand-edit it. `neurons/features/*.md` — path-encoded
grouping cannot be demoted and duplicates the edge set. Zero new tools — ids,
atomicity and idempotence become conventions the model follows *usually*. A
hook-driven self-updating layer — no session lifecycle hook exists, so there is
nothing to hang "what changed" on. A always-larger index — CodeRAG-Bench
(arXiv:2406.14497) shows retrieval can hurt a strong model, and attention dilutes
past budget.

**Tradeoffs accepted.** The ledger grows forever and `git blame` on a relation
shows every version. Accepted: append-only merges cleanly where a rewritten
frontmatter list conflicts. ULID filenames are unreadable in `ls`. Accepted:
`grep -rl 'kind: feature' .spectre/brain/neurons/` and `recall`. Nothing is ever
deleted, so the folder is a history rather than a state.

**First thing to build.** `ledger.ts` and `recall.ts`, because the format is the
irreversible decision and `recall`'s own answer is the report card. The smallest
slice worth having alone: `mnemonic` seeds thirty claims and one ledger by hand,
`tools.spectre.brain({action:"recall"})` answers a real question, and the answer is
compared against `ripwire --callers` for the same question. If it does not beat
it, the format is wrong and no write action gets built.

**Verified at the tag, and one of them changed the design.** Both OpenCode
questions are settled by reading `v2.0.26`, and the permission one contradicted
what this document first claimed: an absolute-path rule matches nothing for a
project-local write, because the resource is project-relative. See "What OpenCode
already does".

**Open questions.**

- What is the drift signal? "This claim's subjects have not changed in 90 days"
  is a heuristic, and it is the one place the design reaches for a judgement with
  no oracle. Unresolved, and it is why `demote` exists rather than a reaper.
- The claim cap for stage 1 of the seed is a guess. It wants a measurement, and
  the measurement is the smallest slice in "First thing to build".
- **Drift detection has no procedure, and this repo already knows what one looks
  like.** `maintain-verification-skill` is the upkeep loop for the feature map
  this design is trying to be generalise: locate, index, a fan-out of read-only
  readers, reconcile against source, triage into three destinations, ship or
  stop. The brain's version has one problem the verification map does not — there
  is nothing to drive. A feature claim has no harness, so the "live pass" phase
  has no equivalent, and the substitute is ripwire plus git. Whether that
  substitutes for a live drive is the largest untested claim in this document, and
  it is why the seed is bounded and evidence-gated rather than authoritative.
- **The maintenance loop is not in scope here, and that is a decision with a
  cost.** A brain that is only ever seeded decays, and `demote` is a manual tool
  call rather than a pass. The honest sequencing is that a `maintain-brain` skill
  comes after the seed has a measured hit rate, and until then the drift shows up
  as a wrong `recall` answer that the caller can see.
- Does `recall` need the `subject` parameter at all, given `query` alone covers
  the dominant pattern? It is on the signature because stage 2 hands evidence
  back per subject, and that is the only reason it earns a field.

## Sources

- Generative Agents, arXiv:2304.03442 — recency + importance + relevance scoring.
- MemGPT, arXiv:2310.08560 — recall separated from archival. The agent pages.
- CoALA, arXiv:2309.02427 — working / episodic / semantic / procedural.
- Zep, arXiv:2501.13956 — validity windows. Supersede rather than co-retrieve.
- A-MEM, arXiv:2502.12110 — why rewriting a neighbour note drifts.
- Reflexion, arXiv:2303.11366 — bounded reflection, 1 to 3 lessons, no provenance.
- HippoRAG, arXiv:2405.14831 — multi-hop retrieval as graph spread.
- MemoryBank, arXiv:2305.10250 — why recency decay deletes what matters.
- BEIR, arXiv:2104.08663 — BM25 is the zero-shot baseline that holds at this scale.
- CodeRAG-Bench, arXiv:2406.14497 — retrieval can hurt a strong model.
- SWE-Bench-CL, arXiv:2507.00014 — measure memory by downstream delta.
- Anthropic, "Effective context engineering for AI agents" — hybrid: tiny
  always-on index, just-in-time reads.
- OpenHands persistent memory — the `<UNTRUSTED_CONTENT>` envelope.
- Aider repo map — tree-sitter plus PageRank, which this repo has as `ripwire`.
- OpenCode at `v2.0.26`: `packages/core/src/tool.ts`,
  `packages/core/src/plugin/plan.ts`, `packages/plugin/src/effect/tool.ts`.