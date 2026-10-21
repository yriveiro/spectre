# model-router

Read the task, ask the resolver for a model, spend the ref it returned, say what you chose.

## The four steps

1. **Evaluate.** Read the task and work out what it actually asks for. Do this
   before you look at any profile. A line or two: how much reading, how much
   judgement, and what a wrong answer would cost.
2. **Ask.** Call `tools.spectre.routing({})`. It reads `spectre.json` (and
   `spectre.jsonc` when that is the file there), merges the global and project
   files, and resolves every profile against the live catalogue.
3. **Choose.** Take the profile whose `match` line fits your evaluation. The
   profile's `effort` is the thinking it needs, and the resolver has already
   turned that into one model. You do not pick a rung.
4. **Spawn.** Call `subagent` with `model: profile.model.ref`, copied exactly,
   variant included. Then say the choice in one line.

If your evaluation already settled on a profile, pass its name:
`routing({ profile: "refactor" })` returns that one row and puts the name in
`asked`. That is the only use of the argument.

You need no permission. In the ordinary case there is no follow-up question either:
the model is chosen before the work starts, so the choice is yours to make, not the
spawned agent's. The one exception is `setup`, where the user answers once.

## What a profile is for

A profile has two prose fields, and only one of them routes.

- `match` is the routing surface. It names the moment the profile is for, with
  the nouns a prompt would carry, and one exclusion. Match the task against this
  line.
- `why` is the rationale, for the human who wrote the config. The resolver never
  reads it. A `why` line that sounds like a better fit than `match` is not a
  reason to pick that profile.

The profile also states `effort`: how much thinking the task needs. The resolver
reads the allowlist order and the catalogue, takes the first allowed model that
reaches that effort, and records the rung it used. Do not second-guess the rung.
The ref that came back is the answer.

## The evaluation is about the task, not about difficulty

"Difficult" is a feeling, and it drifts toward whatever sounds most serious. Look
at what is in front of you instead: how many files or symbols the task names,
whether the answer has to be right or only reported, and what being wrong would
cost. Running a command and reading its log is not the work of understanding a
subsystem, however serious the wording.

Say the evaluation out loud before you call. If you cannot state it in a line, you
do not yet know what the task is, and routing on a guess spends the wrong model.

## One case is not a judgement call

A literature, citation, or research task does not go on the cheap profile. A cheap
model returns a clean, tidy bibliography whose references do not resolve, or resolve
to a different paper. Nothing in the text looks wrong, so a human reading the answer
cannot catch it. This is the one task where the cheap model is the wrong model, and
it holds however simple the request reads.

## The model string is a whitelist

`tools.spectre.routing` returns a ref that was checked when you called it. **Use it
exactly as returned**, variant suffix included.

That ref is the whole vocabulary. The user wrote down which models they are willing
to spend on, and it is usually shorter than what the provider offers. A model outside
the list is not spendable here no matter how well it fits, so if nothing in the list
fits the task, say so and ask. Do not go looking in the provider for something better.

Never write a model id from memory, never assemble one from a provider you remember,
never guess a variant. A string this tool did not return is one nobody checked. The
subagent call fails on it, or worse, lands on a model that exists and is wrong for the
job.

This matters more than it sounds. You are choosing what the work costs. A model you
invent is a cost nobody agreed to, and it is invisible in the result.

## What the answer carries

A profile row has one `model`, and that is the model to spend:

```text
{
  name:     "worker",
  match:    "Use when the change is already decided …",
  effort:   "high",
  agent:    "spectre",
  model:    { ref: "opencode-go/deepseek-v4.1-flash#high", rung: "high", … },
  crosscheck:        { ref: "opencode-go/minimax-m3.1-flash-free#high", … },  // optional
  crosscheckProblem: "…",                                                     // optional
  excluded: [ { name: "glm", ref: "…", reaches: "max", reason: "…" } ]
}
```

- `model.ref` is the string to pass. `model.steppedUp` is true when the ladder
  had no rung at `effort` and took `model.rung` instead, and `model.below` is the
  rung under the one used. Say it when you explain the choice.
- `crosscheck` is the second opinion the profile asked for, from another family,
  at the effort the profile stated. Its `ref` is a second string to spend. Use it
  when the task is a decision and a second family is worth the spend. Run it
  beside the first, not instead of it.
- `crosscheckProblem` means the profile asked for a second opinion and no allowed
  model from another family could give one. Say it. Do not invent a second model.
- `excluded` lists the candidates that did not qualify, with the highest rung each
  one reaches. It explains why a model you expected is not here. It is not a menu
  to fall back to.

## The tool answers four ways, and each needs a different reply

1. **`status` is `resolved`.** The `profiles` are the routing table. Evaluate,
   choose by `match`, spawn.
2. **`status` is `setup`.** No config file exists anywhere, so routing has not been
   configured. The answer carries `provider`, the starter `models`, and the starter
   `profiles`. Put the default on the table and ask the user once whether to start
   from it. If yes, call `routing({ setup: "accepted" })` and route from the answer
   it gives. If no, call `routing({ setup: "declined" })` and spawn without a model.
   Do not write `spectre.json` by hand.
3. **`status` is `declined`.** The user said no before, and the answer is stored in
   `source`. Do not ask again. Leave `model` off the `subagent` call, so the agent's
   own model runs the work. Say once that this repository routes on no model. If the
   user wants routing later, they remove the `setup` key from that file.
4. **`status` is `problems`.** The config is there and wrong. `problems` lists every
   mistake, one per line, and each line names the key. Quote the lines, say routing
   is misconfigured, then ask whether to continue on the current model. Do **not**
   fall back to a model you remember, and do not retry with a different string.

`model` is optional on the `subagent` tool, so every path spawns something.

## The subagent tool

| Argument | Required | What it is |
| -------- | -------- | ---------- |
| `agent` | yes | which spectre agent to spawn; always one spectre registers |
| `description` | yes | a 3-5 word label for the task |
| `prompt` | yes | the task itself |
| `model` | no | `providerID/modelID` or `providerID/modelID#variant` |
| `sessionID` | no | continue a previous child instead of starting one |
| `background` | no | run without blocking the caller |

`model` outranks the agent's own model and is applied before the run starts, so one
agent serves every profile. The default is `spectre`, which is selectable in a chat
and spawnable as a subagent, so routed work runs under the same style as the chat that
routed it.

**Every routed run is a spectre agent, and that is the point.** The config refuses any
other agent name, so a routed subagent cannot quietly drop out of spectre mode by
being some other agent. Take `agent` from the profile when it names one: `sicko` is a
narrow persona for comment work and is the wrong agent for anything else. The spectre
agents differ in persona and in chat visibility, not in permissions, so there is no
other reason to reach for one.

## Decompose, do not just delegate

A task that spans several kinds of work is usually three. Evaluate each part on its
own, then route each part separately, in parallel where they do not depend on each
other. One call gives you every row you need:

```text
const t = await tools.spectre.routing({})

subagent({ agent: t.profiles[1].agent, prompt: "find the call sites", model: t.profiles[1].model.ref })
subagent({ agent: t.profiles[2].agent, prompt: "choose the change",     model: t.profiles[2].model.ref })
```

The rows above are examples. Take the profiles whose `match` lines fit the two parts,
not the ones at those positions. A cheap profile is genuinely good at the mechanical
parts: grep, read, run, report. Spending the expensive profile on that is waste.
Spending the cheap one on the judgement is the failure above. Decomposing is how you
get both right.

## A worked example

Task: *run the test suite and tell me what failed.*

The evaluation comes first, and it is about the task:

> One command, one log to read, and the deliverable is a report. Nothing to decide,
> so the profile whose `match` names a command and a log.

Then the menu, then the choice:

```text
const t = await tools.spectre.routing({})
// t.status === "resolved"
// t.profiles: [{ name, match, effort, agent, model: { ref, rung, … }, … }, …]

const mechanical = t.profiles.find((one) => one.name === "mechanical")

subagent({
  agent:       mechanical.agent,       // whatever the tool returned
  description: "Run tests, report failures",
  prompt:      "Run the test suite. Report which tests failed and why, quoting the first failing assertion. If everything passes, say so plainly.",
  model:       mechanical.model.ref,   // copied exactly
})
```

Then one line, out loud:

> Routed to `mechanical` on `opencode-go/deepseek-v4.1-flash#low`. One command and
> one log, no judgement needed.

One line because a model choice nobody hears about looks exactly like a mistake once
it turns out to be one.
