# Routing by requirement (effort), not by model id

Status: Phase A has landed, and so have the page, the corpus and the judge.
The policy that reads the judge's probability, and the live terminal proof of
the page, have not. This file states what the feature must do, the platform
facts it relies on with a source for each, the plan to follow, and what is
still open. It is a requirements document, not a log of the design that
produced it.

It replaces the parts of [model-routing.md](./model-routing.md) that couple a
profile to a model id. That file stays: the tool, the skill, the config surface
and the mechanism it proved are still there.

## Goal

A profile states **what a task needs**: the moment it is, and how much thinking
that moment needs. The model is **resolved at call time** from two other
places — the allowlist the user wrote, and the live catalogue. The user
configures all of it from a page in the terminal, against the catalogue that
is actually there.

Three concerns, three homes:

| Concern | Home | Written by |
| --- | --- | --- |
| What the task is | `profiles.<name>.match`, and `why` for the human | the user, once |
| How much thinking it needs | `profiles.<name>.effort` | the user, once |
| What may be spent | `models` (the allowlist) | the user, in the page |
| What exists, and what it costs | the catalogue, read per call | the provider |

## Why the coupling has to go

`profiles.<name>.model` names a model and a variant, so the profile holds the
task class, the required effort and the spend at once. Three costs follow.

**The allowlist becomes a ladder written in the wrong alphabet.** The current
file lists sixteen entries — `glm-low`, `glm-high`, `glm-max`, `deepseek-low`
… — where four models and five effort levels would do. Every entry exists to
carry a variant, and a variant is the one thing the catalogue owns.

**The ids go stale in two places at once.** The file's own comment records it:
`deepseek-v4.1-flash` is `deepseek-v4.1-flash-free` on Zen and
`deepseek-v4.1-flash` on Go, and the contributor model is
`muse-spark-1.3` on Zen and `muse-spark-1.3-contributor` on Go. A ref that
names a model and a variant has to be re-checked against every provider the
user might move to.

**The routing failure is not misrouting.** [model-routing.md](./model-routing.md)
names the likelier cause: the `subagent` tool's own description reads *"NEVER
set this unless the user explicitly asks for a particular model or variant"*,
so the model is being told two opposite things and a conflict is a reason a
model quietly declines. A profile that names an effort is easier to honour
than one that names a spend, because the spend is no longer in the sentence
the model reads.

## What it must do

- **R1. A profile states a required thinking effort, not a model.** `effort` is
  the field. `model` stays as an optional pin for the case where the user
  wants a specific ref. A pin wins over `effort`, and the page marks it
  "pinned".
- **R2. The effort scale is the full range the models support.** It is read
  from the catalogue on every call, not hardcoded. A profile may name a level
  only some models reach, and that is information, not an error.
- **R3. The allowlist stays the user's.** `models` keeps its entries, and
  their **order is the preference order**: the first entry that fits is the
  one that is spent. The report states the cost beside each candidate and never uses
  to reorder, because the current file's policy is deliberate — the paid
  families lead, and the free model is the last rung.
- **R4. An alias names a model, never a policy.** Aliases are standardized
  (below) and a rename changes nothing about routing, because the cross-check
  rule reads the catalogue's `family`, not the alias.
- **R5. The config is JSON.** The reader tolerates comments; the writer never
  writes one. The canonical name is `spectre.json`. `spectre.jsonc` is still
  read, so an existing setup keeps working.
- **R6. A repository with no config asks once.** The router reports that the
  repository needs setup, the session asks the user with a default on the
  table, and the session writes the answer down so it never asks again.
- **R7. The terminal can configure it.** A page lists the profiles, the
  allowlist and the live catalogue, and every choice is a dialog over the
  catalogue.
- **R8. The resolver reports what it chose and what it could not reach.** A
  profile that asks for an effort no allowed model reaches is a problem, and
  a model that had to step up to meet one says so.
- **R9. The judge is optional, and the workflow runs without it.** A judge
  that is absent, disabled in the config, unreachable, or too slow must not
  stop a delegation. The work still gets done, with the agent's own judgement
  in the judge's place, and the report says which path ran.

## Platform facts

Every fact here comes from the tag `v2.1.1`, the version floor.

| Fact | Source |
| --- | --- |
| `Model.Info` carries `variants` (the effort ladder ids), `family`, `cost` (a tiered array), `status`, `enabled` and `capabilities.tools` | `packages/schema/src/model.ts` at `v2.1.1` |
| The variant ids are the effort names, in ladder order, because the app builds them from the provider's effort list | `packages/core/src/variant.ts` at `v2.1.1` (`Variant.resolve`) |
| `ctx.model.list()` returns the catalogue; `ctx.model.transform` can edit it | <https://opencode.ai/v2/docs/build/plugins/effect/> |
| The TUI plugin API gives a page (`ui.router.register`), a searchable select (`ui.dialog.select`), named slots (`ui.slot`) and durable storage (`storage.store`) | `packages/plugin/src/tui/context.ts` at `v2.1.1` |
| A plugin package exposes a TUI entrypoint as an export named `./tui` | `oc-yubikey`'s `package.json` |
| `Bun.JSONC.parse` reads comments and trailing commas, and reports no position for a break | `AGENTS.md` |
| The `subagent` model argument outranks the agent's own model, and is written into the session record before the run | [model-routing.md](./model-routing.md), verified at `v2.1.1` |

### The ladders are ragged, and that is the shape of the problem

From the `opencode-go` provider in the catalogue (`packages/core/src/models-dev/snapshot.txt` at `v2.1.1`):

| Model | family | cost in/out | ladder |
| --- | --- | --- | --- |
| `muse-spark-1.3-contributor` | muse | 0.1 / 0.2 | minimal, low, medium, high, xhigh |
| `minimax-m3.1-flash-free` | minimax | 0 / 0 | low, medium, high, xhigh, max |
| `glm-5.3-flash` | glm-flash | 0.15 / 0.5 | low, high, max |
| `deepseek-v4.1-flash` | deepseek-flash | 0.15 / 0.6 | low, high, max |
| `deepseek-v4-pro` | deepseek-thinking | 0.66 / 1.98 | high, max |
| `kimi-k3` | kimi-k3 | 3 / 15 | max |

Seven of the provider's thirty-four models declare no effort at all. A profile
that names an effort is therefore naming something only part of the catalogue
can do, and the resolver has to say which part.

## The config

```jsonc
{
  "provider": "opencode-go",
  "models": {
    "glm-flash":      "opencode-go/glm-5.3-flash",
    "deepseek-flash": "opencode-go/deepseek-v4.1-flash",
    "muse":           "opencode-go/muse-spark-1.3-contributor",
    "minimax":        "opencode-go/minimax-m3.1-flash-free"
  },
  "profiles": {
    "mechanical": { "effort": "low", "match": "Use when …", "why": "…" },
    "search":     { "effort": "medium", "match": "Use when …", "why": "…" },
    "worker":     { "effort": "high", "crosscheck": { "effort": "high", "prefer": "free" },
                    "match": "Use when …", "why": "…" },
    "judgment":   { "effort": "high", "crosscheck": { "effort": "high", "prefer": "free" },
                    "match": "Use when …", "why": "…" },
    "thinking":   { "effort": "max", "match": "Use when …", "why": "…" },
    "deep":       { "effort": "max", "match": "Use when …", "why": "…" },
    "refactor":   { "effort": "high", "match": "Use when …", "why": "…" }
  },
  "dictionary": "/absolute/path/to/asd-ste100-dictionary.json"
}
```

`provider` is the default the page opens with and the default the starter set
writes. It is not a restriction: the allowlist may mix providers.

`crosscheck` is the second opinion, stated as a requirement rather than as a
model id. The current ladder's third and fourth rungs were not preferences.
They were a rule: a second family, and a free one where the free model could
do it.

### Field rules

| Key | Rule |
| --- | --- |
| `models` | An alias and a ref. The alias is `^[a-z0-9][a-z0-9-]*$`. The order is the preference order. |
| `models[*]` | `"providerID/modelID"`. A variant may be pinned here; it is then the only rung the model is asked for. |
| `profiles[*].effort` | An effort name from the catalogue. Not a closed enum: the range is read per call. |
| `profiles[*].model` | Optional. A pin. It wins over `effort`. |
| `profiles[*].crosscheck.effort` | Optional. The effort the second opinion is asked for. |
| `profiles[*].crosscheck.prefer` | Optional. `"free"` takes a zero-cost candidate where one qualifies. |
| `profiles[*].match` | The routing surface: the moment, with the nouns a prompt would carry, and one exclusion. |
| `profiles[*].why` | The rationale, for the human. Never read by the resolver. |
| `profiles[*].agent` | Optional. Must be a spectre agent. Defaults to `spectre`. |

### The alias standard

The alias names a model, so it cannot carry an effort.

- **Base**: the catalogue's `family`, slugged — `glm-flash`, `deepseek-flash`,
  `muse`, `minimax`.
- **Disambiguation**: when the base is taken in the allowlist, extend it with
  the model id's tail (`muse` + `muse-spark-1.3-contributor` →
  `spark-1.3-contributor`), and then with the provider (`muse-zen`).
- **Charset**: `^[a-z0-9][a-z0-9-]*$`, so an alias can never be mistaken for a
  ref.
- The page proposes. The user renames. **Policy never reads the alias.** The
  cross-check rule reads the catalogue's `family`.

## The effort rule

- **Known order**, for sorting and for qualification:
  `none < minimal < low < medium < high < xhigh < max`.
- **Unknown names** — a provider invents `turbo` — are **exact match only**. A
  profile may name one, and only a model that declares it qualifies. No
  nearest-guessing on a name nobody knows.
- **`none` and `thinking` are not rungs.** They are a toggle pair, and the
  host builds a toggle model's ladder as `[none, thinking]`
  (`packages/core/src/variant.ts:35-37` and `:52` at `v2.1.1`). `none` is the
  off state and `thinking` is the on state, so neither is a rung on an effort
  ladder. A toggle model serves `none`, and it serves `thinking` only when a
  profile names that name.
- **Qualification**: a model qualifies at requirement *R* when its ladder
  holds a rung at or above *R*. The resolver takes the **lowest qualifying
  rung** — the least thinking that still meets the bar.
- **Gaps are reported**: `medium` on `glm-5.3-flash` (ladder `low, high, max`)
  resolves to `high` and says that the ladder has no rung between low and high.
- **Capacity** — how many rungs a model has and how high it reaches — is a
  fact the page shows and the resolver reports when a requirement excludes a
  candidate.

## The resolver

```
resolve(profile, allowlist, catalogue):
  1. candidates ← allowlist entries, in file order, that resolve in the
     catalogue, are enabled, are not deprecated, and can call tools
  2. rung(m)    ← the lowest rung of m's ladder at or above profile.effort
                  (exact match only for a name outside the known order;
                   a model with no ladder qualifies only for "none")
  3. primary    ← the FIRST candidate that qualifies        ← the user's order
  4. crosscheck ← the first candidate whose catalogue family differs from the
                  primary's; prefer "free" takes the first zero-cost one
  5. report     ← the ref, the ladder, the gap when there was one, the cost
```

Raising the effort raises the money by itself, because "the cheapest model
that can do *E*" moves to a pricier model as *E* rises. That is what makes a
later policy possible: spend more where the judgement is unsure.

## The architecture

Three candidates wrote a skeleton for this feature, each on a different model
family, and a fourth read all three against a rubric. This section is the
synthesis: the base, what the graft added to it, and what each decision cost.

### The base

The base is the seat that made an effort a **sum type** and a ladder **two
arrays**. The reason is that it is the only shape in which the rule cannot be
violated by accident:
```ts
export const KNOWN_ORDER = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const

export type Effort =
  | { readonly kind: "known"; readonly name: KnownEffort; readonly rank: number }
  | { readonly kind: "unknown"; readonly name: string }

export type Ladder = {
  readonly ranked: ReadonlyArray<KnownEffort>
  readonly unranked: ReadonlyArray<string>
}

export type Fit =
  | { readonly kind: "rung"; readonly at: Effort; readonly want: Effort; readonly below: Effort | undefined }
  | { readonly kind: "floor" }
  | { readonly kind: "short"; readonly best: Effort | undefined }
```

An effort name the order cannot rank has no position in an ordered list, and
putting it in one invents a position for it. Two arrays keep that name
comparable only to itself, so "a name outside the known order matches exactly"
is a property of the type rather than a rule a comparator has to remember.

The known order sorts the ladder, and **array order does not**, because the
array order is the provider's taste: `Variant.resolve` passes the provider's
declared effort values through unsorted
(`packages/core/src/variant.ts:32-37`, `packages/models-dev.ts:115` at
`v2.1.1`). Every model in the snapshot happens to declare its values
ascending, so index order works today and is not a guarantee. A provider that
declared `["high", "low"]` would make a resolver that trusts index order step
*down*.

### The verdict

A fourth seat read all three against six criteria and scored them: the base
took 18 of 18, the other two tied at 13, and the second seat ranked as the
runner-up.

Its strongest objection to the base is worth keeping: the base commits the
page's machinery — the barrel, the writer's own file, the origin provenance,
the held writes, a second tsconfig, four dev dependencies, and a file the
plan never named — inside a Phase A skeleton, so ten files stand where the
plan names five and half the structure sits idle when the page slips.

The answer is to subtract. This skeleton lands what Phase A needs and nothing
else: the schema, the module sketches, and the tests. The barrel, the page
and the writer's own file wait for Phase B, and the feature that needs them
waits with them. A file that exists for a feature that does not exist yet is
a file nobody reads.

The graft the judge asked for is in the tool's output. The base modelled the
"yes" answer to the setup question and left the "no" answer out, so the
promise that the session never asks twice did not hold for the answer that
matters most. The output carries a fourth outcome, `declined`, beside
`resolved`, `setup` and `problems`.

### The module map

```
tools/definitions/routing/
  types.ts      the config schema and the tool output union. Schemas only.
  locate.ts     which files, in which order.
  load.ts       read, tolerate comments, merge whole entries.
  effort.ts     the effort rule. Pure, and it knows no module below it.
  catalogue.ts  what a Model.Info means: family, ladder, cost, capacity.
  resolve.ts    the selection policy and the report.
  check.ts      validation against the catalogue.
  write.ts      writing the config, and the alias proposal.
  index.ts      the tool declaration, the setup outcome, the public barrel.

tui.tsx         the page, at the repository root, exported as "./tui".
```

The dependency direction is one way: `effort` at the bottom, `catalogue` above
it, `resolve` and `check` above that, `index` at the top. The page is outside
the folder and reads the **barrel**, never a sibling, so the folder rule in
`AGENTS.md` survives its second consumer.

`catalogue.ts` is a file the first draft of the plan did not list, and it is
the one that keeps the check and the resolver honest: one normalizer, two
callers. Two readers of the same shape drift, and the failure lands as
routing onto a model the check passed, which is the failure the check exists
to prevent.

### The tool output is a union

```ts
const Output = Schema.Union([Resolved, Setup, Problems])
```

A flat struct would carry `resolutions`, `starter` and `problems` as
optional fields on every outcome, so a consumer could not tell from the type
which fields the answer carries, and the spread that keeps a flat struct honest is
exactly the construct the union removes. `tools/FOR_AGENTS.md` already names a
union of structs as the cheapest way to make the output honest, and it is
inside the sandbox subset.

### What was grafted

| From | What | Why |
| --- | --- | --- |
| the second seat | **The decline marker lives in the config file.** `{"setup": "declined"}` in the repository's own `spectre.json`. | The plugin has no core-side durable store, and the TUI's `storage.store` is not readable from the tool's process. The answer has to be a file the reader already looks at. |
| the second seat | **The page reads the barrel**, and the barrel re-exports what the page needs. | `AGENTS.md`: a second consumer of internals is the signal the boundary is wrong. The answer is the declaration deciding what is public. |
| the third seat | **The excluded list is part of the report.** Every candidate that did not qualify carries the highest rung it reaches. | An unreachable effort then reports capacity instead of silence. |
| the third seat | **The writer refuses on a bad file.** It decodes what is there before it writes. | A config that works is never overwritten by a broken one, and a typo'd key is reported rather than deleted. |
| all three | **The effort is an open string plus one ordered constant.** Never a closed union. | A provider that invents `turbo` stays a legal exact-match requirement instead of a schema error. |
| the third seat | **A preview over a draft.** The page shows what an unsaved edit resolves to, through the same rule the router uses. | A page that cannot show the consequence of an edit makes the user save before it knows what the save does. It is Phase B, and the preview is a function over a draft and the catalogue, so it lands with the page. |

### A rejected alternative worth keeping

Put the resolution in a `ctx.tool.hook("execute.before")` that rewrites the
`subagent` tool's input, so the skill spawns with a profile name and the
plugin swaps the ref in. No string to paste, and no way to call a stale one.

It lost for three reasons. The hook's ability to mutate the input in place is
unverified. It moves the decision below the session's visibility, and the
skill must say which profile it chose and why, so that line needs an
anchor. And the resolution report has to be data, which a hook cannot return.

It is the honest next step **after** this feature, because it is the real fix
for the failure this feature cannot fix: the `subagent` tool's own
description tells the model never to set `model`, and a skill that says the
opposite loses that argument. A hook would end the argument.

### What the synthesis costs

- **`none` is a floor, not an exact request.** A profile asking for `none` is
  spent at a model's lowest rung, and the report says it stepped up. One seat
  wanted `none` to be exact-match only, so that a profile meaning "do not
  think" cannot be served a model that thinks. Both readings are defensible
  and they disagree about what one word means, so it is an open question below
  and not a settled decision.
- **The effort is checked at call time, not at decode time.** A cost on every
  call, bought as forward compatibility with a provider that invents a name
  tomorrow.
- **One allowlist order, and today the order is per profile.** The current
  file leads with GLM for the two cheap profiles and with DeepSeek for the
  five harder ones. A single order cannot carry both, so one of them changes.
  The choice is the user's, and it is an open question below.
- **The tool withholds the whole table on any problem.** One good row is lost
  to a broken one, bought as never routing onto a broken row.

## The judge, and the workflow without one

The judge is the thing that picks a profile from a task. It is optional, and
the design keeps it optional rather than making it load-bearing.

### Where the judge sits, and where it does not

The routing path has two steps, and they are not the same kind of step.

| Step | Who does it | Without a judge |
| --- | --- | --- |
| **Which profile** — the judgement | the judge, or the agent | the agent, against the `match` lines |
| **Which model** — the resolution | the resolver, always | the resolver, always |

The judge sits at the first step only. The second step is mechanical: the
allowlist order, the effort rule and the catalogue. A judge that is absent
changes who answers the first question and changes nothing about the second.

That is the whole design rule: **the judge never names a model.** It names a
profile and a probability, both drawn from a list the user wrote. A judge that
said "spend it on this model" would be a second resolver, and two resolvers
disagree. The policy may raise the effort when the probability is low, and
the resolver still picks the model, and the allowlist order still decides
which one.

### The switch

The judge lives in the config, beside the rest of it:

```jsonc
{
  "judge": {
    "model": "jev-1.13-free",
    "endpoint": "https://opencode.ai/inference/systemone/v1/systemone",
  }
}
```

No `judge` key means no judge. The key is absent from the schema in the
build that has no judge, and a config that carries it is a problem that names
the key, which is honest: that build has no judge to run.

### The judge, in three arms

The judge is one interface with three arms, and Phase C measures all three on
the same corpus before any of them goes into the tool.

| Arm | What it is | What it can say |
| --- | --- | --- |
| **lexical** | BM25 over the `match` lines | a profile, and no probability |
| **model** | a chat model asked to name a profile | a profile, and no calibrated probability |
| **jev** | a System One model asked the same question with typed criteria | a profile, and the probability the model reports |

The two arms that are not Jev have no calibrated probability, and the design
says so rather than inventing one. A lexical score is not a probability, and a
chat model's confidence is not a calibrated one. The policy that raises the
effort needs the third arm, so the policy waits for it.

The Jev arm asks the question in the shape the model expects: a `state`,
which is the task statement, and a `choice` question whose criteria are the
profiles' `match` lines. The answer carries the choice and the probability
for every criterion, so one call returns the profile and the confidence.

The measurement decides the rest. A judge that does not beat the lexical arm
on the corpus, priced by regret, is not worth a network call in the hot path,
and the tool routes from the table as it does today.


### What happens when it does not answer

| Case | What the tool does | What the session does |
| --- | --- | --- |
| No `judge` key | the report says the judge was skipped and why | the agent reads the `match` lines and picks |
| The key is there and the user turned it off | the same | the same |
| The endpoint is unreachable | the same, and the reason names the failure | the same |
| The call takes too long | the same, and the reason names the timeout | the same |
| The answer names a profile the config does not have | the same, and the reason names the profile | the same |
| The answer is a profile | the report carries the profile and the confidence | the agent spawns on the resolved model |

Every row ends the same way, and that is the point: **the fallback is the
behaviour that already works.** The agent picks the profile today, with the
same `match` lines, so a missing judge is not a new code path. It is the old
one with less help.

### The contract it adds

The tool's input grows one optional field and its output grows one field.

- `input.task` — the task statement, when the caller wants the judge to
  choose the profile.
- `output.judge` — `used` with the profile and the confidence, or `skipped`
  with the reason.

Both are additive. A caller that passes no task never reaches the judge, and a
report that says `skipped` is a complete answer.

### What less efficient means here

Without the judge, the agent spends its own thinking on the profile choice, in
the parent's context, and the choice can differ between two runs of the same
task. With the judge, one small call answers the same question the same way
every time, and the parent keeps that context for the work.

The judge costs a request and a key, and it buys consistency and a
probability the policy can threshold on. When it is missing, the workflow
still runs and still routes on a model the user allowed. It just pays for the
judgement in the parent's context instead of in a call.


## Phase D: the judge, built

The judge is one interface with two arms, and the config decides which one
answers.

```ts
export type Verdict =
  | { readonly kind: "profile"; readonly profile: string; readonly confidence: number | undefined }
  | { readonly kind: "quiet"; readonly why: string };
```

The confidence is `number | undefined` on purpose. The lexical arm has a
score and not a probability, and a score dressed as a probability is a number
a policy would threshold on wrongly. Only the System One arm can report a
probability, because it is the only one that has one.

### The config

```jsonc
{
  "judge": {
    "kind": "jev",
    "model": "jev-1.13-free",
    "endpoint": "https://opencode.ai/inference/systemone/v1/systemone",
    "key": "OPENCODE_API_KEY",
    "timeout": 2000
  }
}
```

`kind` is `lexical` or `jev`. The `key` is the **name of an environment
variable**, never the key itself, so the file holds no secret. A file with no
`judge` key has no judge, and `"judge": null` in a repository's file turns a
judge off that a global file asked for, through the same merge rule the other
keys use.

### The tool's contract

The tool's input grows one optional field, `task`, and the `resolved` outcome
grows one field, `judge`: `used`, with the profile and the confidence, or
`skipped`, with the reason.

**The judge never names a model.** It names a profile, and the resolver
resolves that profile exactly as it resolves any other, and the allowlist
order still decides which model is spent. The confidence changes neither the
model, nor the rung, nor the price: a confidence is something a *policy* may
read later, and the policy is not built yet.

### The arms, measured

The lexical arm moved out of the eval harness and into the product, because
`eval/` is not published and the harness must measure the arm the router would
use rather than a copy of it. The move proved itself by parity: the old ranking
and the new one, over the real corpus and the real config, disagree on **none
of the fifty rows**, and the product's arm reproduces the measured 18 of 42 and
the seven fires on the negative rows.

| arm | hit | rate | regret | fired on negatives |
| --- | --- | --- | --- | --- |
| lexical over the `match` lines | 18/42 | 42.9% | 18.000 | 7 of 8 |
| **the System One arm** | **39/42** | **92.9%** | **2.250** | **0 of 8** |
| a model asked to name a profile | 39/42 | 92.9% | 2.250 | 0 of 8 |

The System One arm ties the best of the others on the hit rate, matches it on
the silence, and adds the one thing neither of the others has: a **calibrated
probability** on the profile it chose. It costs 668 input tokens and 73 output
tokens per question, and it answers a closed question with a label rather than
with prose. The corpus measured the arm as the corpus was built: two writers
who never saw the surface, and a surface they never read.

### The way out of the question is not decoration

A choice question with a closed set of labels **always** answers with one of
them. Measured on the corpus, the System One arm named a profile for all
eight negative rows, because nothing in the question let it say otherwise.

The fix is one criterion: the question carries a label for "this request is not
work of any kind", and the answer of that label is a quiet verdict. With it,
**all eight negative rows say none, and no judged row changes its answer.**
The corpus caught it because a negative row asks the matcher to stay quiet,
and the arm had no way to.

That is the same rule the corpus follows — a negative row asks the
matcher to stay quiet — and it is the difference between a judge that routes
everything and a judge that routes.

The arm needs a key, and this machine has one that works:
the Console API key in the background service's environment
(`~/.config/opencode/service.json`, under `env`).

The credential OpenCode holds for the Console integration is in its own store,
and the plugin can reach it through the host's integration API
(`packages/core/src/model-resolver.ts:373-376` at `v2.1.1` resolves every
provider's credential that way, and a provider without its own integration id
uses its provider id as the integration id). So the tool asks for the Console
credential when the config names no key variable, and the arm carries it.

**The credential OpenCode holds for the `opencode` provider is a different
thing and does not work.** Tried against the live host: the chat-completions
route answers **403**, the models list **401**, and the System One route
**401** with `Invalid credential`. The key that works is the Console API key
from the dashboard, and the service's environment carries it.

The failure is legible rather than silent: the arm turns a status that is not
a success into a quiet verdict whose reason names the status, the tool reports
that as `skipped`, and the session picks the profile itself. The workflow
without a judge is the workflow with a broken judge.

The measurement settles what the judge is for. **It is not accuracy**: a chat
model reading the same seven lines already takes 92.9%, and a lexical arm
cannot hold the boundaries at all. What the System One arm has that nothing
else has is a **probability**, and a probability is what lets a policy raise
the effort where the judgement is unsure. That policy is the next thing to
build, and it is not built.


## The open questions, restated

1. **What does `none` mean** — the floor of a model, or an exact request for
   a model with an off switch? The two readings disagree about one word.
2. **Which family leads the allowlist.** One order has to serve every
   profile, and today the order is per profile. This is the user's policy
   call, not a design one.
3. **The page picker scope** — the union of every rung in the catalogue, with
   a count of how many allowed models reach each, or a model first and the
   rungs derived from it.
4. **Where the setup answer is written** — the repository's file, the global
   one, or both. The proposal is the repository's, with the global offered.
5. **What the page does with a profile no allowed model reaches** — offer the
   closest rung, or refuse with the capacity report. The tool reports it
   either way.

## Phase C: what the measurement says

The corpus is fifty blind rows: six for each of the seven profiles, and eight
negative rows that fit none of them. Two writers wrote it, on two model
families, from the taxonomy alone, and neither of them read a `match` line. None of
the fifty rows shares a four-word run with any `match` line, which
`eval/routing/tests/` holds them to, so the corpus is not the surface reading
back the words that wrote it.

The first read, on the lexical arm over the `match` lines:

| Arm | hit@1 on the judged rows | negative rows it stayed quiet on |
| --- | --- | --- |
| lexical over `match` | 18 of 42, **42.9%** | 1 of 8 |
| lexical over `why` | 14 of 42, **33.3%** | 1 of 8 |

The random floor over seven labels is 14%, so the surface routes better than
chance and a long way short of the 97.4% the skill harness's description arm
reaches. Two things fall out of the table. The `match` lines are worth about
ten points over the rationale, which is the first measured case for the split.
And a lexical matcher cannot stay quiet: it fires on seven of the eight
requests that fit no profile, because a bag of words has no way to say
"none".

### The confusion matrix is the useful part

| expected → got | mechanical | search | worker | judgment | thinking | deep | refactor |
| --- | --- | --- | --- | --- | --- | --- | --- |
| mechanical | **3** | 0 | 0 | 3 | 0 | 0 | 0 |
| search | 3 | **2** | 0 | 1 | 0 | 0 | 0 |
| worker | 2 | 0 | **1** | 0 | 0 | 0 | 3 |
| judgment | 0 | 0 | 2 | **3** | 0 | 0 | 1 |
| thinking | 2 | 1 | 0 | 0 | **2** | 1 | 0 |
| deep | 2 | 0 | 0 | 1 | 0 | **2** | 1 |
| refactor | 0 | 0 | 0 | 0 | 1 | 0 | **5** |

Eight of the twelve `worker` and `refactor` rows swapped between them, and
three of the six `search` rows went to `mechanical`. The words overlap, and
so do the meanings: "rename that setting everywhere" is a decided change and a
restructure that alters no behaviour, and only one of those is the label a
human would pick.

### Two readings, and the measurement that tells them apart

The overlap can be two different problems, and they call for opposite fixes.

**The labels are too close.** `worker` and `refactor` need a sharper
boundary, and the fix is in the `match` lines: the discriminator is whether
the change alters what the code does, and the lines have to say so. A fresh
blind batch measures the sharpened surface.

**The boundaries are semantic and a bag of words cannot hold them.** Knowing
that a rename changes no behaviour is a fact about the task, not a fact about
the vocabulary, and a lexical arm has no way to weigh it. The fix is a reader
that reasons, which is the judge.

The two are told apart by the model arm, which reads the same seven lines and
answers with judgement rather than with term frequency. If the model arm
beats the lexical arm on the `worker` and `refactor` rows, the second reading
holds and the judge has a job to do. If it does not, the labels need cutting
and no judge will save them.

### What the blind slice costs

A blind row gets one read. The surface is about to change because of what this
read shows, and the rule in `eval/README.md` is that such a row moves into
`tuned` and a fresh row takes its place. So the fifty rows become the
in-sample slice, the numbers above stay on the record as the honest read they
were, and the next number comes from a fresh batch written blind.


## The plan

### Phase A — the resolver, no page, no judge

| File | Change |
| --- | --- |
| `tools/definitions/routing/types.ts` | `effort`, `crosscheck`, `match` on a profile; `model` becomes an optional pin; `provider` on the config; the tables follow |
| `tools/definitions/routing/locate.ts` | `spectre.json` first, `spectre.jsonc` second, one file per directory, global before project |
| `tools/definitions/routing/effort.ts` *(new)* | the known order, the ladder, the qualification rule, the gap report |
| `tools/definitions/routing/resolve.ts` *(new)* | allowlist to primary, crosscheck and report |
| `tools/definitions/routing/check.ts` | the effort names against the catalogue; the alias charset; an unreachable effort is a problem |
| `tools/definitions/routing/index.ts` | the new row shape; the `setup` outcome for a repo with no config |
| `tools/definitions/routing/write.ts` *(new)* | the canonical JSON writer; it decodes before it writes and refuses on a bad file |
| `skills/definitions/model-router/SKILL.md` | evaluate, call the tool, pick the profile by `match`, spawn with the returned ref |
| `spectre.json` | the migrated config: four aliases, seven profiles with `effort` and `match` |
| `spectre.jsonc.default` → `spectre.default.json` | the starter set the setup path writes |
| `features/model-routing.md`, `features/README.md`, `AGENTS.md` | the new fields, the file names, the TUI entrypoint |

### Phase B — the page

A root `tui.tsx` and an export named `./tui`, the shape `oc-yubikey` uses. The
page lists the profiles, the allowlist and the catalogue. Every choice is a
`ui.dialog.select` over the catalogue with the cost and the ladder in the
footer. A slot in the composer shows what the current profile resolves to.

### Phase C — the routing surface and its measurement

`match` lines written to the house rule — *the description is the routing
surface, so it names the moment and not the subject* (`skills/FOR_AGENTS.md`) —
then a corpus of tasks with the profile a human would pick, the arms (a lexical
arm over `match`, a lexical arm over `why`, the agent's own choice), and the
metric that matters: cost-weighted regret, not accuracy.

### Phase D — the judge

A judge that picks the profile from the `match` lines and returns a
probability, so the effort can be raised where the judgement is unsure. The
judge is swappable — a lexical arm, a cheap classifier, or a decision model —
and it never names a model. That is Phase D and a separate file.

## Open questions

1. **How many effort levels does a profile get to name?** The full range is
   the catalogue's, and a profile can name a level only one model has. The
   question left is whether the *page* offers the union as a picker or asks
   for a model first and derives the levels from it.
2. **Does the setup path write the project file, the global one, or both?**
   The proposal is the project file, with the global offered, because a
   repository whose owner has not chosen yet is a repository that has not been
   configured.
3. **What does the page do with a profile that names an effort no allowed
   model reaches?** It could offer the closest reachable rung, or refuse.

## What this file does not decide

- Which model a task actually gets. That is the resolver, and it is a
  function of the allowlist and the catalogue.
- Whether the judge is worth building. Phase C measures the arms first, and
  the answer that comes back may be that the lexical arm is enough.
- The `match` wording itself. That is a corpus task, and the corpus is
  Phase C.
