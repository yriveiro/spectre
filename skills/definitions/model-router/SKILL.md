# model-router

Read the task, see what is allowed, spend one model, say what you chose.

## The four steps

1. **Evaluate.** Read the task and work out what it actually asks for. Do this
   before you look at any model. A line or two: how much reading, how much
   judgement, and what a wrong answer would cost.
2. **Ask.** Call `tools.spectre.routing({})`. It reads `spectre.jsonc`, merges the
   global and project files, and checks every allowed model against the live
   catalogue. Each profile's `why` is the config saying when that choice fits, so
   match your evaluation against those lines rather than against what you remember
   the names meaning.
3. **Choose.** Take the profile whose `why` matches your evaluation, then one of its
   `models`.
4. **Spawn.** Call `subagent` with that string, then say the choice in one line.

If your evaluation already settled on a profile, pass its name —
`routing({ profile: "refactor" })` returns that one row. That is the only use of the
argument.

No permission needed and no follow-up question. The model is chosen before the work
starts, so the choice is yours to make, not the spawned agent's.

## The evaluation is about the task, not about difficulty

"Difficult" is a feeling, and it drifts toward whatever sounds most serious. Look at
what is in front of you instead: how many files or symbols the task names, whether
the answer has to be right or only reported, and what being wrong would cost. Running
a command and reading its log is not the work of understanding a subsystem, however
serious the wording.

Say the evaluation out loud before you call. If you cannot state it in a line, you do
not yet know what the task is, and routing on a guess spends the wrong model.

## One case is not a judgement call

A literature, citation, or research task does not go on the cheap model. A cheap
model returns a clean, tidy bibliography whose references do not resolve, or resolve
to a different paper. Nothing in the text looks wrong, so a human reading the answer
cannot catch it. This is the one task where the cheap model is the wrong model, and
it holds however simple the request reads.

## The model string is a whitelist

`tools.spectre.routing` returns strings that were checked when you called it.
**Use them exactly as returned**, variant suffix included.

That list is the whole vocabulary. The user wrote down which models they are willing
to spend on, and it is usually shorter than what the provider offers. A model outside
the list is not spendable here no matter how well it fits, so if nothing in the list
fits the task, say so and ask. Do not go looking in the provider for something better.

Never write a model id from memory, never assemble one from a provider you remember,
never guess a variant. A string this tool did not return is one nobody checked. The
subagent call fails on it, or worse, lands on a model that exists and is wrong for the
job.

This matters more than it sounds. You are choosing what the work costs. A model you
invent is a cost nobody agreed to, and it is invisible in the result.

## A profile can have several models

`profiles[].models` is a list, in the order the config wrote it. Take the first one
that fits. Go to a later one only when the task is plainly harder than the one before
it, and say that you did:

> Routed to `refactor` on the second model. Several subsystems, and the first is the
> cheap one.

Do not walk the list for the strongest option. A list is a preference order, not a
menu to maximise from: taking the last entry every time makes the earlier ones
pointless and spends money the user said not to spend.

## The tool answers three ways, and each needs a different reply

1. **Rows came back.** That is the allowlist. Evaluate, choose, spawn.
2. **`problems` is set.** The config is there and wrong. Say routing is misconfigured,
   quote the problems, then ask whether to continue on the current model. Do **not**
   fall back to a model you remember, and do not retry with a different string.
3. **`sources` is empty and there are no problems.** There is no `spectre.jsonc`
   anywhere, so routing is not set up. This is not a failure and not a reason to stop.
   Leave `model` off the `subagent` call: it is optional, and the agent's own model
   runs the work. Say once that spectre has no allowlist, and carry on. Asking the
   user for permission every time you would have delegated is worse than not routing.

`model` is optional on the `subagent` tool, so all three paths spawn something.

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

**Every routed run is a spectre agent, and that is the point.** The tool refuses any
other agent name, so a routed subagent cannot quietly drop out of spectre mode by
being some other agent. Take `agent` from the profile when it names one: `sicko` is a
narrow persona for comment work and is the wrong agent for anything else. The two
spectre agents differ in persona and in chat visibility, not in permissions, so there
is no other reason to reach for one.

## Decompose, do not just delegate

A task that spans several kinds of work is usually three. Evaluate each part on its
own, then route each part separately, in parallel where they do not depend on each
other. One call gives you every row you need:

```text
const t = await tools.spectre.routing({})

subagent({ agent: t.profiles[0].agent, prompt: "find the call sites", model: cheap })
subagent({ agent: t.profiles[0].agent, prompt: "choose the change",     model: strong })
```

`cheap` and `strong` are rows you picked from what came back. A cheap model is
genuinely good at the mechanical parts: grep, read, run, report. Spending the
expensive model on that is waste; spending the cheap one on the judgement is the
failure above. Decomposing is how you get both right.

## A worked example

Task: *run the test suite and tell me what failed.*

The evaluation comes first, and it is about the task:

> One command, one log to read, and the deliverable is a report. Nothing to decide,
> so the cheapest profile that can run a command and read its output.

Then the menu, then the choice:

```text
const t = await tools.spectre.routing({})
// t.profiles: [{ name, models: [{ name, model }, …], agent, why }, …]

subagent({
  agent:       t.profiles[0].agent,          // whatever the tool returned
  description: "Run tests, report failures",
  prompt:      "Run the test suite. Report which tests failed and why, quoting the first failing assertion. If everything passes, say so plainly.",
  model:       t.profiles[0].models[0].model, // copied exactly
})
```

Then one line, out loud:

> Routed to `mechanical` on its first model. One command and one log, no judgement
> needed.

One line because a model choice nobody hears about looks exactly like a mistake once
it turns out to be one.
