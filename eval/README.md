# `eval/`

Measures how a request gets routed to a skill. BM25 over the same descriptions is
in the table beside the models, so a lexical arm and a model arm can be read
against each other on one corpus.

This is a first-class citizen and not a test helper. The port depends on it, and
the numbers in `skills/FOR_AGENTS.md` come from here. It is not in the published
package: `package.json`'s `files` allowlist excludes it, which `npm pack
--dry-run` confirms.

## Running it

```sh
bun run eval                     # every free model, all rows
bun run eval -- --held-out       # only the rows that predate current work
bun run eval -- --model=opencode/mimo-v2.6-flash-free
bun run eval -- --no-ripwire     # skip the lexical arms
```

To keep a run and diff the next one against it:

```sh
SPECTRE_EVAL_BASELINE=eval/baseline.json bun run eval -- --held-out
```

The second run prints a signed change per arm and lists every row whose answer
changed. A leaf that gains four rows and loses four is not progress, and the
aggregate hides that, which is why `flips` is separate from the score.

`SPECTRE_EVAL_CONCURRENCY` sets the in-flight requests per model, default 6.
`SPECTRE_EVAL_PORT` sets the server port, default 4489.
`SPECTRE_EVAL_DELAY` sets the gap between requests in milliseconds, default 0,
and `SPECTRE_EVAL_ABORT_AFTER` sets how many identical failures halt a model,
default 3.
`SPECTRE_EVAL_MODELS`, `SPECTRE_EVAL_VARIANT`, and `SPECTRE_EVAL_SKIP` override
the pinned model, pin one variant, or drop one by name.

## The layout

| File | Holds |
| --- | --- |
| `fixture.ts` | The corpus: prompt, permitted labels, provenance, and the held-out slice |
| `mirror.ts` | Writes descriptions to a directory ripwire can index |
| `opencode.ts` | The only file that knows the HTTP API |
| `boot.ts` | Starts `opencode serve`, reads the registration line |
| `catalogue.ts` | Checks our skills against what OpenCode says it registered |
| `observe.ts` | Extracts the decision: the activation, the tool call, or the prose |
| `score.ts` | Pure scoring and the table |
| `record.ts` | Pure snapshot, delta, and flip detection |
| `progress.ts` | The display |
| `reporter.ts` | The two files a background run writes |
| `models.ts` | Which models run, and the variants they carry |
| `guard.ts` | Stops a run whose failures are systemic rather than routing |
| `run.ts` | The orchestrator |

`score.ts`, `record.ts`, `observe.ts`, `progress.ts`, `models.ts`, `guard.ts`,
`reporter.ts`, `boot.ts`, and `catalogue.ts` are pure or near-pure and have unit
tests beside them. A harness whose scoring is untested is the failure
`principle-evidence` names, so the scoring is the part covered first.

## What is measured

The activation, not the prose. A model saying "I would load no-comments" stated
a preference; a model that loaded it did the thing OpenCode routes on. `observe.ts`
grades four kinds of evidence and the table prints one column each, as
`skill/tool/text/silent`:

| Column | What it saw |
| --- | --- |
| `skill` | An activation OpenCode recorded as its own message |
| `tool` | A `skill` tool call inside an assistant turn |
| `text` | Prose naming a catalogue id |
| `silent` | Nothing at all |

Blending those four into one column is what hides a model that states the right
answer without ever acting on it, so they stay apart.

Rows labelled `none` are real: a model that correctly loads nothing scores a hit,
and one that loads something scores a miss. An id the plugin does not register
is counted apart as `off-catalogue`, because reaching for a skill that is not
there is a different failure from choosing the wrong one of ours.

## Why it runs inside OpenCode

A direct provider call would be faster and would measure our reconstruction of
the skill catalogue rather than the catalogue. So the eval boots a real
`opencode serve` with this checkout as the plugin, and the model answers with the
same prompt it gets in production.

That has a cost, and the cost is the reason these were all measured rather than
assumed:

- **The catalogue is checked against the log, not the API.** `GET /api/skill`
  answers 200 with the global catalogue, grows for a few seconds, and then
  settles at a fraction of ours. The `Registered skills` log line carries all of
  them. The route is eventually consistent and partial, so trusting it raises a
  false alarm on every leaf. The session instruction entries are worse: they come back
  empty, so there is no `<available_skills>` block to read at all.
- **The project initialises lazily.** The first `/api/skill` or `/api/model`
  for a fresh server answers 200 with an empty array. Reading one call as the
  truth skips the whole sweep and says nothing about why.
- **`directory` is a query parameter** on every call. Sending
  `x-opencode-directory` alongside it makes the route return an empty catalogue.
- **`wait` and `remove` answer 204 with no body.** Parsing every response as
  JSON turns every row into "Unexpected end of JSON input".
- **The scratch directory and its config must exist before the spawn**, because
  the directory becomes the child's cwd and the plugin is loaded from there. And
  `OPENCODE_CONFIG_DIR` is deliberately not set, because it replaces the whole
  config directory, which is also where the provider credentials live.

## Reading the numbers

Scores are not comparable across corpora, and this number moves as the corpus
grows. Measured on 2026-09-28 against 16 skills, `bm25-desc` scores 50.0% on the
held-out slice (22 rows) and 59.4% on all rows (75). ripwire also reports the
judged rows alone, which is the honest number because the other rows quote the
descriptions: 11/22 and 38/64. Re-run the lexical arm before quoting any of
these, and say which corpus and which slice the figure came from.

The held-out slice is the `heldOut` export in `fixture.ts`, not a set derived
from git. It used to be derived, by comparing prompts against
`git show HEAD:test/skills/fixture.ts`, and that was wrong twice over: it read a
path the working tree has since deleted, and it matched every row that predated
the current work, which is all 72 of them, so `--held-out` scored the whole
corpus. Naming the slice in `fixture.ts` puts the decision where a reader looks
for it and makes the count auditable. Rows written while testing a change are
dev data and their scores flatter the change, so they belong in `tuned`.
