# Model routing — `spectre.jsonc`

Status: designing. Nothing built yet.

## What we want

A skill that looks at a task, works out how hard it is, and spawns a spectre agent
on a model that fits. The models come from a config file you write yourself.

The two examples you gave:

- **Mechanical work** — something a CLI did: run the tests, read the log, tell me
  what happened. No real thinking needed, so the cheapest model is the right one.
- **Arena** — run several models on the same question and judge the answers. That
  one is for later. See [arena.md](./arena.md). We do not need it to build any of
  this.

## Three things about OpenCode that decide the design

Read these first. Everything after them follows from these.

### 1. The `task` tool cannot take a model

I checked the live tool schema in a real 2.0.18 session. The only arguments are
`description`, `prompt`, `subagent_type`, `task_id`, `command`, `background`. There
is no `model`.

OpenCode picks the model itself, from the agent, before your call does anything:

```ts
// packages/opencode/src/tool/task.ts:181-184   [read at dev, not at 2.0.18]
const model = next.model ?? {
  modelID: msg.info.modelID,
  providerID: msg.info.providerID,
}
```

**So:** "look at the task, then pass a model" is not something we can do with the
normal `task` tool. There are only three ways to change which model a spawn uses:

1. The agent itself carries a `model` (field `model` on `Agent.Info`, it is
   optional).
2. Something calls `session.switchModel` on the child session after it is created.
   That is what the `opencode-subagent` plugin does. It races the first model call.
3. We skip `task` and use `ctx.generate.text({ prompt, model })` — a one-shot call
   with an explicit model. No session, no tools, no loop.

We are going with 1 and 3.

### 2. "Thinking effort" is just a field on the model

`Model.Ref` is `{ id, providerID, variant? }` (checked in the installed
`@opencode/schema@2.0.18`). That `variant` field **is** the thinking-effort setting.
OpenCode builds it from each model's reasoning options
(`provider/transform.ts:1717`): effort levels, or a toggle, or a token budget, with
the value `"none"` for "do not think".

So a cheap model with no thinking is just:

```jsonc
{ "ref": "anthropic/claude-haiku-4-5", "variant": "none" }
```

No separate thinking setting to invent.

### 3. `explore` already exists and we can pin a model to it

This one needed digging, because the obvious check does not work.

`draft.update` is an **upsert**. If the agent is not there yet, it makes a blank
one:

```ts
// core/src/agent.ts:56-61
const current = draft.agents.get(id) ?? (Info.empty(id) as Types.DeepMutable<Info>)
```

So seeing `update("explore", ...)` in OpenCode's own code does not prove `explore`
is there. If it were not, that call would create an agent with no prompt and no
permissions.

What actually settles it is order. OpenCode's own built-in agent plugin creates
`build`, `plan`, `general`, `explore`, `compaction`, `title`, `summary` inside a
`State.batch`, while the `plugin-internal` layer boots — before any outside plugin
loads (`core/src/plugin/internal.ts:105-121`).

So when spectre's code runs, `explore` is already in the list, with its prompt and
its permissions. We can just set the model on it.

And OpenCode's `explore` is already close to what we want:

```ts
// core/src/plugin/agent.ts:161-186
explore: { mode: "subagent", system: PROMPT_EXPLORE, permissions: [
  { action: "*", effect: "deny" },      // cannot edit anything
  grep, glob, webfetch, websearch, read  // but can search and read
]}
```

Read-only, blocked from editing, already has search and web tools. All it lacks is
a model. So `explorer` is a one-line pin. Writing our own explorer from scratch
would be worse — we would be copying a prompt and a permission list that upstream
already maintains.

*One risk left:* that boot uses `Effect.forkScoped({ startImmediately: true })`, so
the order leans on a semaphore inside `State`. Worth one log line to confirm for
real. Not a blocker, but not proven either.

## Why "tiers" was the wrong main idea

My first draft had three ordered levels — `mechanical`, `standard`, `deep` — and
named agents pointing at them. That does not survive the profiles you asked for:

- `explorer` and `paper-research` are **not** different amounts of thinking. They
  are different amounts of *power*. One may not write anything. The other may
  write to one notes file. That is a tool and permission difference, not a
  thinking difference.
- You cannot put them in a line. `explorer` is cheap in thinking and limited in
  power. `paper-research` is expensive in thinking and limited in power. They sit
  side by side, not one above the other.

So we split it in two:

- **`models`** — a flat list. Just the model names, written once so we do not
  repeat them.
- **`profiles`** — the thing we actually build. A profile says which model, which
  tools, which permissions, which skill.

A profile becomes one agent. `models` is only there to avoid copy-paste.

## The shape

```jsonc
{
  "$schema": "https://…/spectre.schema.json",

  // Just model names. Nothing else lives here.
  "models": {
    "mechanical": { "ref": "anthropic/claude-haiku-4-5", "variant": "none" },
    "standard":   { "ref": "anthropic/claude-sonnet-4-5", "variant": "medium" },
    "deep":       { "ref": "anthropic/claude-opus-4-1",   "variant": "high" }
  },

  // The real unit. Every part of spectre reads this list.
  "profiles": {

    // "pin" means: change an agent that already exists. We do not rewrite it.
    "explorer": { "pin": "explore", "model": "mechanical" },

    // No "pin" means: spectre builds a new agent from this.
    "refactor": {
      "model": "deep",
      "scope": "write",
      "description": "Multi-symbol changes. Read the blast radius before editing."
    },
    "paper": {
      "model": "deep",
      "scope": "notes:research/**",
      "skills": ["paper-research"],
      "requires": { "websearch": "any" },
      "description": "Gather and synthesise academic literature. No citation it did not read."
    }
  },

  "arena": {
    "candidates": ["explorer", "paper"],
    "max_candidates": 3,
    "judge": "main"
  }
}
```

### `pin` and "no pin" are two different things

`"pin": "explore"` means *change an agent that is already there*. No new agent gets
made. Nothing gets shadowed.

No `pin` means spectre calls `update(id, …)` with a body it wrote itself.

Keeping them apart stops one specific bug: a new profile whose name happens to
match a built-in agent would quietly overwrite that built-in, and — depending on
order — could leave a broken agent with no prompt and no permissions. So a `pin`
that cannot find its target has to **stop at startup with an error**, not shrug
and continue.

### Checks at startup

All cheap. All at plugin start. All of them stop everything and name the key that
is wrong:

1. Every `models[*].ref` exists in `ctx.model.list()`, and every `variant` is in
   that model's list of variants. This is the one that matters most. A typo here
   gives you an agent pointed at nothing, and nothing anywhere says so. The
   `opencode-subagent` plugin gets this right, and it is the check a hand-written
   config file is most likely to get wrong.
2. Every `profiles[*].model` names something in `models`.
3. Every `pin` target is in the agent list. Missing = error.
4. No new profile has the same name as a built-in agent.
5. `arena.candidates` all name real profiles. `max_candidates` is a whole number
   above zero.
6. If a profile says `requires.websearch`, a web search provider is actually
   configured. A paper profile with no search provider looks alive and cannot do
   its one job.

## The `paper` profile

This one is different from the others, because the way it fails is not "worse
answer". It is "confident wrong answer".

**Invented citations are the danger.** Give a cheap model a literature question
and it will hand back a clean, tidy bibliography. The arXiv IDs in it will not
resolve, or will resolve to a completely different paper. Nothing in the text
looks wrong. You cannot catch this by reading the answer — that is the whole
problem.

Three things follow, and the order matters:

1. **No cheap model here.** Reading a lot of paper and getting the gist right is
   exactly where made-up references come from. This profile is `deep`, no
   exceptions. It is the one place in the whole config where the money buys
   correctness instead of polish.
2. **Checking has to be a second pass, not a rule.** Telling the model in the
   prompt "only cite what you read" is a request. It can be ignored and you cannot
   tell. Going back and fetching every ID to see if it resolves is evidence. So
   make it a separate profile — `verifier`, on `mechanical`, one job, no writing,
   no summary — fetch and compare, nothing else. It can be cheap because it does
   almost nothing.
3. **It needs somewhere to write.** A real literature run is longer than one
   subagent's context. Without a notes file that only ever gets added to, the
   context gets compacted, the trail is gone, and the agent starts re-reading
   papers it already read. That is why its scope is `notes:research/**` and not
   "read only".

One more split worth being clear about: the **method** (how to search, what shape
to write findings in, the rule about citations) goes in a **skill**. The **body**
(model, permissions, write scope, which tools) goes in the profile. The profile
just points at the skill: `"skills": ["paper-research"]`.

The limit of that: the rule only applies when that profile runs that skill. That is
a real gap, and it is the reason the verifier is a second agent instead of one more
paragraph in the prompt.

## What the "classifier" actually is

Not code. A skill that reads a task and picks a profile name.

The tempting version is to ask the model how hard the task is. Models are bad at
this. They guess about as well as a coin that lands on the answer that sounds best.
Better to use boring, checkable signals:

| What I see in the task | Use |
| ---------------------- | --- |
| One named file, or a command to run | `mechanical` |
| A diff, a stack trace, a failing test name | `standard` at least |
| Several symbols, a whole subsystem, or the word "refactor" | `deep` |
| Asks for outside evidence, papers, citations | `paper` |

Then the skill says: pick the profile, spawn it with `task`, and say in one line
which profile it picked and why. One line, because a model choice you do not say
out loud looks exactly like a mistake once it turns out to be one.

**Still open:** is that table worth more than just always using `standard` and only
going up when something looks hard? A router that is often wrong is worse than no
router. Worth testing before we trust it.

## Open questions

1. **Where does the config file live?** Global only, global plus project override,
   or project only? Global defaults plus a project override is the obvious answer.
   Not written down yet.
2. **JSONC.** Bun has `Bun.TOML.parse` but no JSONC reader. OpenCode uses
   `jsonc-parser` as a real dependency; spectre does not have it. So either drop the
   `c` and use plain `.json`, or add the dependency and write it down in the
   exceptions table in `AGENTS.md`. Comments are worth something in a file whose
   whole job is to be read by a person deciding which model bills them.
3. **The transform order** from point 3 above. One log line settles it.
4. **Should a profile be allowed to list `permissions` directly**, or only say
   "write" / "none" and let spectre work out the rules? Working it out is safer —
   a profile cannot then ban `read` and wonder why it is blind.
5. **Cost limits.** `Model.Info.cost` has `input` / `output` / `cache` per million
   tokens, so we can work out what a profile costs per call at startup. Whether
   spectre warns or refuses on an expensive default is undecided.

## Where these facts come from

Checked against the installed `@opencode/*@2.0.18` in `node_modules`: the `model`
field on `Agent.Info`, the shape of `Model.Ref`, the `task` tool's arguments, the
`websearch` and `generate` domains.

Read at the `dev` branch, **not** checked at 2.0.18: `task.ts:181-184`, the
`explore` permissions in `core/src/plugin/agent.ts`, the upsert behaviour in
`core/src/agent.ts`, the boot order in `core/src/plugin/internal.ts`, and
`reasoningVariants`. Treat these as strong hints. Re-check the boot order in
particular before we depend on it.

From the other repo,
[`opencode-subagent`](https://github.com/barreiroleo/opencode-subagent) at
`master`: 20 commits, 1 person, MIT, no tests, no CI, pinned to
`@opencode/plugin@2.0.7`, and written in the promise style rather than Effect.

- **Took:** checking a model name against the real catalog before using it.
- **Left:** the TUI half (it needs `@opentui/*` and `solid-js` just to show a
  picker), the single global value (one model for every spawn — the opposite of
  this feature), and the code itself (wrong version, wrong style).
