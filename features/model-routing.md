# Model routing (`spectre.jsonc`)

Status: built. The tool is `tools/definitions/routing/`. `model-router` is the
skill that calls it.

## Goal

Given a task, pick a model that fits the difficulty and run the work on it, from a
config file a human writes and edits. The `spectre` agent serves both roles. The
model is chosen per call.

The two motivating cases:

- **Mechanical work.** Something a CLI did: run the tests, read the log, report
  what happened. No real thinking needed, so the cheapest model is correct.
- **Arena.** Run several models on the same question and judge the answers. Later;
  see [arena.md](./arena.md). Nothing in this file depends on it.

## Mechanism

Three properties of OpenCode 2.0.26 make this possible without intercepting
anything. All three verified at tag `v2.0.26`. Sources in the appendix.

1. **The subagent tool takes a model per call.** `agent`, `description`, `prompt`,
   `model`, `sessionID`, `background`. `model` is optional and written as
   `"providerID/modelID"` or `"providerID/modelID#variant"`.
2. **The model is applied before the run starts.** Precedence is
   `tool argument > agent.model > parent model`. It is written into the session
   record at `sessions.create`, and the `sessions.prompt` that follows carries no
   model of its own.
3. **The model is re-read from the session record before every step**, so a switch
   that lands mid-run applies from the next step onward.

Consequence: routing is one argument in one tool call. A single agent serves every
profile, and a wrong `model` string fails loudly at call time with the list of what
is available.

**This fights the tool's own instruction.** The `model` argument's description at
`subagent.ts:38-42` reads *"NEVER set this unless the user explicitly asks for a
particular model or variant."* Spectre's whole premise is setting it on every routed
call. A skill's instructions outrank a tool schema description, so the skill wins when
it is loaded, but the model is being told two opposite things and a conflict is a
reason a model quietly declines. This is the most likely explanation for routing that
does not happen, and it is unresolved.

```text
agent: "spectre",  model: "opencode/mimo-v2.6-flash-free"
agent: "spectre",  model: "opencode/space-bunny-free#max"
agent: "spectre",  model: "opencode/muse-spark-1.3-contributor-free#high"
```

## What OpenCode already does

The point of this section is what spectre does **not** have to do. Every claim is
read at the tag. The appendix cites each one.

- **Parsing a ref.** `Model.Ref.parse` splits `providerID/modelID#variant` into a
  branded `{ id, providerID, variant? }` and throws on a bad shape. `ConfigModel.Selection`
  decodes the same string in OpenCode's own config.
- **The catalogue.** `ctx.model.list()` returns `Model.Info[]`, which carries
  `variants` per model. That is the list a ref is checked against, so spectre does
  not build or cache a catalogue.
- **Resolving and reporting a bad ref.** `model-resolver.ts` already words these
  failures: `Variant unavailable for …`, `Model unavailable: …`.
- **Shape, required fields, and unknown keys.** The config is an Effect Schema, so
  decoding reports the path to the mistake: `profiles.p.why: Missing key`. Decoded
  with `onExcessProperty: "error"`, an unrecognised key is rejected and named.

What is left for spectre is the policy OpenCode has no opinion about: **which
models this user allows themselves to spend**, and **a name for a choice, with a
reason attached**.

## Config surface

Two keys. Neither builds an agent. This is spectre's own config and it is not
OpenCode's: `opencode.jsonc` only loads the plugin.

- **`models`.** The spend whitelist. A name, and the ref to spend. Every model
  string the router may emit is one of these.
- **`profiles`.** The router's vocabulary. A name, the model or ordered models it
  resolves to, and the reason, so a choice is legible rather than arbitrary.

```jsonc
{
  "models": {
    "mechanical": "opencode/mimo-v2.6-flash-free",
    "standard":   "opencode/muse-spark-1.3-contributor-free#high",
    "deep":       "opencode/space-bunny-free#max"
  },

  "profiles": {
    "explorer": {
      "model": "mechanical",
      "why": "One named file, or a command to run. No real thinking needed."
    },
    "refactor": {
      "model": ["deep", "standard"],
      "why": "Several symbols, or a whole subsystem. Read the blast radius first."
    }
  }
}
```

The ref is one string, not an object with `ref` and `variant` fields, because
`Model.Ref` already carries the variant and the `subagent` tool takes the same
string. Two fields to keep in step would be a field that can disagree with itself.

Those two sections are the whole surface. Anything else is an error, and the
rejection does not special-case what it rejects: a typo and another feature's key
land in the same bucket. Arena is built *on* these profiles, so it gets its own keys
and its own feature file. Routing does not know it exists.

### Field rules

| Key | Rule |
| --- | ---- |
| `models[*]` | `"providerID/modelID"` or `"providerID/modelID#variant"`. Must resolve in the catalogue. |
| `profiles[*].model` | Required. A key in `models`, or a list of them in order of preference. |
| `profiles[*].why` | Required. One line saying when this choice fits. The router matches the task against it. |
| `profiles[*].agent` | Optional. Must be a spectre agent. Defaults to `spectre`. |
| `$schema` | Accepted and ignored. There is no emitted JSON Schema artifact. |

An unrecognised key is an error, not a shrug. A typo in a key that decides what
bills you must not pass silently.

### Why not tiers

An ordered ladder (`mechanical`, `standard`, `deep`) cannot express the real
cases, for two reasons.

**Power is not a rung.** A profile that may not write anything and a profile that
may write one notes file are not "less" and "more" of each other. They differ in
permissions, which is not a model property and cannot sit on a line.

**The model is not a property of the agent.** It is a call argument. A rung needs
no agent of its own. It needs a different string in the same call.

**The power axis is not reachable from the config, and that is a choice.** It lives on
the agent, and the only agents a profile may name are spectre's own. Today that is
`spectre` and `sicko`, which differ in persona and in chat visibility, not in
permissions — so a profile cannot buy a different write scope, and the escape hatch
this section used to promise is closed.

It is closed on purpose: a routed subagent that is not a spectre agent is a run that
is not in spectre mode, and spectre mode is the thing being bought. The cost is that
a genuinely narrower run needs a new spectre agent, written and reviewed like any
other, rather than a line in a config file. That is the right way round.

### Where it lives

| File | Path | Role |
| ---- | ---- | ---- |
| Global | `~/.config/opencode/spectre.jsonc` | defaults, on every repo |
| Project | `<repo>/spectre.jsonc` | changes for this repo only |

- **A later entry replaces the earlier one whole.** Not field by field. A project
  that wants a different `why` writes the whole profile. There is no patch type,
  and no way for a file to be half an entry.
- **`null` removes** an inherited key. It is the only thing that means remove, and
  it is kept through the merge precisely so it can overwrite the key it removes.
- **Merge first, check second.** Every check runs on the merged result, not per
  file. A bad model in a global file that the project overrides is not a problem,
  and failing on it would block a working repo on a bug in a file it does not use.
- **A broken file does not stop the others.** A global file that will not parse is
  reported and the project file is still read.

The global directory follows OpenCode's own precedence, so a user already pointing
`OPENCODE_CONFIG_DIR` somewhere needs no second thing to remember.

### Reading it

JSONC, comments allowed. Comments earn their keep in a file whose job is to be
read by a person deciding what bills them, and a comment beside a model ref is the
cheapest documentation available.

Parse with `Bun.JSONC.parse(text)`. No dependency, and no hand-rolled comment
stripper. A `//` inside a string literal is the bug such a stripper gets wrong,
and this is the wrong file to be clever in.

Two limits, measured on 1.4.2 rather than assumed, and they decide what a broken
config can honestly be told:

- **No line number.** The `SyntaxError` carries `line` and `column`, and they are
  the same two numbers for every broken document, so they are parser state rather
  than a position. The message does name the offending token, so that is what gets
  reported, with the file path.
- **Trailing content is ignored, not rejected.** `{"a":1} {"b":2}` parses as
  `{"a":1}` with no error. A stray second object is therefore not a parse failure
  and cannot be caught as one.

`Bun.JSONC` is absent from Bun's documentation. Probed on 1.4.2, the version
OpenCode ships, where it handles `//`, `/* */`, and trailing commas. If a future
Bun drops it the failure is a `TypeError` at startup, not a silent misparse.

## Validation

Run when the tool is called, not at plugin start. All checks report at once and
name the key that is wrong. A config problem is an answer the router reads, not a
failure that stops a session: a typo in a repo you are not routing in has no
business breaking the plugin.

1. Every `models[*]` parses as a ref, names a model in `ctx.model.list()`, and
   carries a variant that model actually has. A miss is reported against the
   **allowlist**, not the catalogue: the message names the models this user
   allowed and the ref each one points at. Never the models the provider offers.
   A real installation has a couple of hundred of those, a wall of text is not a
   list a human reads, and every name in it is a model the user did not agree to
   spend on.
2. Every `profiles[*].model` names a key in `models`.

That is the whole list. It is short because the config is small, and it was longer
before: an agent-name check and a `requires` capability check were both cut. The
`subagent` tool validates the agent name and the model ref itself
(`subagent.ts:77-80`), so a second check on the host's own argument is a check on
OpenCode rather than on this config.

Any problem withholds the table entirely. A half-valid table is a table with a
model in it that does not work, and returning the working half invites routing on
the broken one being the obvious choice.

The check that carries the most weight is the first, because its failure moved. A
bad ref becomes a string the router would paste into a `subagent` call, so without
it the failure lands at spawn time, in a place a human did not edit. Check it first
and hand over only strings that passed.

**Not checked:** whether the provider behind a listed model is authenticated. The
catalogue is what `ctx.model.list()` returns, and whether that list is already
filtered to providers this session can reach was not established. A model can
therefore pass the check and still fail at generate time on an auth error.

## The router

Two pieces, and neither one moves a model.

**A tool**, `tools.spectre.routing`. It reads the config, merges, checks, and
returns the strings. That is the whole mechanism: OpenCode already takes a `model`
per `subagent` call, so this answers the only two questions a model cannot answer
for itself: which strings are real, and which one fits the task.

**A skill**, `model-router`. Four steps, in this order:

1. **Evaluate** the task: what it asks for, how much reading it needs, and what a
   wrong answer would cost. Stated in a line, before any model is looked at.
2. **Ask** the tool what is allowed.
3. **Choose** a profile whose `why` matches that evaluation, and one of its `models`.
4. **Spawn** one `subagent` with that string, and say the choice in one line.

The tool is read per call rather than baked into the skill at startup, so a config
edited mid-session routes on the edit without a reload.

**`why` is what step 3 reads.** It is the only description of when a profile fits, so
the skill matches the task against it rather than against a table of signals frozen
into the skill. There is deliberately no such table: a fixed list cannot know about a
profile the user added yesterday, and it goes stale silently. The cost of dropping it
is that the picking rests on the model's own reading of the task, which is the open
question below.

Asking a model how *hard* a task is does not work. Models guess about as well as a
coin, and they guess toward the answer that sounds best. Asking what the task *is* is
different, and it is checkable: how many files or symbols it names, whether the answer
has to be right or only reported, and what being wrong would cost.

```text
subagent({
  agent:  "spectre",
  prompt: "<the task>",
  model:  "opencode/mimo-v2.6-flash-free"
})
```

The skill then says in one line which profile it picked and why. One line,
because a model choice nobody hears about looks exactly like a mistake once it
turns out to be one.

**The model string is a whitelist, not a guess.** The skill carries the exact
strings the check produced, so it picks a *name* from the config and emits the
string that name maps to. It never assembles an ID. This is why the config holds
model refs rather than a difficulty score.

**The allowlist is the whole vocabulary.** The models in `spectre.jsonc` are what
this user allows themselves to spend, and that list is usually far shorter than
what the provider offers. The tool never widens it, and a model outside it is not
spendable on a spectre subagent however well it fits. When nothing in the list
fits, the skill says so and asks rather than reaching outside.

**A profile may name several models, in order of preference.** Take the first that
fits, and go to a later one only when the task is plainly harder, saying that is
what happened. The order is a preference order, not a menu to maximise from:
taking the last entry every time spends money the user said not to spend and makes
the earlier entries pointless.

**Open:** is matching `why` against the task worth more than always taking the first
profile and escalating only when something looks hard? A router that is often wrong is
worse than no router. Testable: run the same task twice and see whether the pick is
stable.

## Open questions

1. **Can `ctx.tool.hook("execute.before")` rewrite the subagent tool's `input`?**
   The hook sees the parsed input including `model`, and the callback returns
   `Effect<void>`, so it cannot return a replacement. Whether an in-place write
   reaches the tool body is unverified. If it works, spectre routes in code with no
   model in the decision and no change for the caller.
2. **Does spectre need a third agent?** A verifier that may not write, and a
   researcher that writes notes, are two different write scopes, and profiles may no
   longer reach them: only spectre's own agents are routable. If the literature case
   below gets built, that is a new agent in `agents/definitions/`, on purpose, with
   its own permissions — not a config key.
3. **Cost limits.** `Model.Info.cost` has `input` / `output` / `cache` per million
   tokens, so a profile's cost per call is computable when the tool runs. Whether
   spectre warns or refuses on an expensive default is undecided.
4. **The `subagent` tool tells the model never to set `model`.** See the mechanism
   section. If routing is unreliable in practice, this is the first suspect, and the
   fix is either a louder skill or the in-code hook in question 1.
5. **The `requires` capability check is gone, and the case it served is not
   solved.** A literature profile with no search provider used to be caught by a
   `requires: { websearch: "any" }` key. It is no longer caught, because the
   capability is not part of the config surface any more. See the worked case below
   for why that case still matters.

## Worked case: the literature profile

Not built. It is the requirement that decided the shape, kept here because the cut
above made it worse and the next person should know that.

Its failure mode is not a worse answer. It is a confident wrong one.

**Invented citations are the danger.** Give a cheap model a literature question and
it returns a clean, tidy bibliography. The arXiv IDs do not resolve, or resolve to
a different paper. Nothing in the text looks wrong, so reading the answer cannot
catch it.

Three requirements, in order:

1. **No cheap model.** Reading a lot of paper and getting the gist right is exactly
   where invented references come from. This profile is `deep`, no exceptions. It is
   the one place the config spends for correctness instead of polish.
2. **Checking is a second pass, not a rule.** "Only cite what you read" in a prompt
   is a request, and a request cannot be verified. Fetching every ID to see whether
   it resolves is evidence. So the check is a separate call: a verifier, on
   `mechanical`, one job: fetch and compare, no writing, no summary. It can be
   cheap because it does almost nothing. That needs a read-only agent, because a
   verifier that must not write needs write permissions denied, and permissions live
   on the agent.
3. **It needs somewhere to write.** A real literature run outruns one subagent's
   context. Without a notes file that is only ever appended to, the context gets
   compacted, the trail is gone, and the agent re-reads papers it already read. So
   the researcher's write scope is on the agent, not in the config.

Method and body stay separate. The **method** (how to search, what shape to write
findings in, the rule about citations) is a **skill**, named by the agent. The
**model** is the profile. The limit is real: the rule applies only when that agent
runs that skill, which is why the verifier is a second agent rather than one more
paragraph in a prompt.

## Appendix: sources

Read at tag `v2.0.26`. A path that does not exist at that tag is not evidence for
anything in this file. The rule for reading the source is in `AGENTS.md`.

| Claim | Where, at the tag |
| ----- | ----------------- |
| subagent tool arguments | `packages/core/src/tool/plugin/subagent.ts:31-45` |
| model precedence: argument > agent > parent | `packages/core/src/tool/plugin/subagent.ts:170`, `:184` |
| model goes to the session record, not the prompt | `packages/core/src/tool/plugin/subagent.ts:188`, `:206` |
| the subagent tool validates the model ref itself | `packages/core/src/tool/plugin/subagent.ts:77-80` |
| a bad model string fails loudly | `packages/core/src/tool/plugin/subagent.ts:86-95` |
| subagent depth limit and its key | `packages/core/src/tool/plugin/subagent.ts:129` |
| model re-read per step | `packages/core/src/session/runner/llm.ts:206`, `:215-216` |
| `switchModel` writes the record | `packages/core/src/session/session.ts:97-110` |
| `Model.Ref.parse` and its brands | `packages/schema/src/model.ts:20-49` |
| `Model.Info.variants` | `packages/schema/src/model.ts:130` |
| the catalogue reaches a plugin as `ctx.model` | `packages/plugin/src/effect/model.ts:25-27`, `packages/client/src/effect/api/api.ts:1524-1526` |
| resolution failures and their wording | `packages/core/src/model-resolver.ts:24`, `packages/core/src/generate.ts:60` |
| an agent's model is stored unresolved | `packages/core/src/config/plugin/agent.ts:105-109` |
| `Config.Agent.Info` carries `model` and `description` | `packages/schema/src/config/agent.ts:12-16` |
| `ConfigModel.Selection` decodes a ref string | `packages/schema/src/config/model.ts:12-31` |
| global config dir precedence | `packages/util/src/global.ts:79`, `packages/util/src/global-roots.ts:7`, `:15` |
| a duplicate plugin id is marked failed, not refused | `packages/core/src/plugin/supervisor.ts:105-110` |

A plugin has **no** `ctx.config`. The config plugins in `packages/core/src/config/plugin/`
are built in and there is no surface for a third party to add config keys, which is
why `spectre.jsonc` is read by hand and `opencode.jsonc` is left alone.

Probed at runtime on Bun 1.4.2 and on the pinned `effect@4.0.0-rc.112`:
`Bun.JSONC.parse` as described under "Reading it"; `Schema.decodeUnknownSync` with
`onExcessProperty: "error"` rejecting `arena` and reporting `profiles.p.why`.

**Unverified:** whether a plugin can mutate `input` inside `execute.before` rather
than only read it. Open question 1 is exactly this.
