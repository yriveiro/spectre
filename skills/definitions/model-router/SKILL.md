# model-router

Read the task, ask the resolver for a model, spend the ref it returns, and say what you chose.

## The four steps

1. **Evaluate.** Read the task and state what it asks for. Do this before you look at any profile. State how much reading it needs, how much judgement it needs, and what a wrong answer would cost. One or two sentences are enough.
2. **Ask.** Call `tools.spectre.routing({ task: "<the task>" })`. The `task` is the statement the judge reads. The tool reads `spectre.json` from the directory of the session, or `spectre.jsonc` when that is the file there. It merges the global file with the project file and resolves every profile against the live catalogue. A session that moved into a worktree reads that worktree's file on the next call.
3. **Choose.** Read `judge` first. When it is `used`, take the row it names. When it is `skipped`, take the profile whose `match` line fits your evaluation. The profile states the thinking it needs, or pins a model. The resolver turns that into one model. You do not pick a rung.
4. **Spawn.** Call `subagent` with `model: profile.model.ref`, copied exactly, variant included. Then say the choice in one line.

If your evaluation already settled on a profile, pass its name: `routing({ profile: "refactor" })` returns only that row and puts the name in `asked`. A named profile is the decision, so the tool does not ask the judge, and `judge.status` is `skipped`.

You need no permission. In the ordinary case there is no follow-up question. You choose the model before the work starts, not the spawned agent. The one exception is `setup`, where the user answers once.

## The judge, and the path without it

The judge answers one question: which profile a task belongs to. It is optional. It names a profile, and a probability when its arm reports one, but never a model. The resolver still picks the model. The judge cannot widen the allowlist or change a pin.

Read `judge` on a `resolved` answer:

```text
judge: { status: "used", profile: "worker", confidence: 0.82 }
judge: { status: "skipped", reason: "The config names no judge, so the profile choice is yours." }
```

- **`used`.** The judge chose. Take the row whose `name` is `judge.profile`, and spend it. `confidence` is the probability the judge reported, when its arm reports one. Say the number beside the choice when it is there.
- **`skipped`.** The judge gave no profile, and `reason` says why. Take the profile whose `match` line fits your evaluation. That is the path this skill describes, and the choice is no less correct for it.

A skipped judge is a complete answer. The table is whole either way, and every row carries a model the resolver chose. Do not call the tool again to get a judge answer.

## When nobody knows, play safe

A probability below the threshold means the judge does not know which profile this is. Not knowing is a reason to spend **more**, not less. The tool asks for that profile one effort step higher and sets `judge.escalated` to `true`. `judge.effort` names the effort it used. The resolver resolves the profile again at the higher effort, so the row can name a different model. At the top rung there is nothing above, so the row stays at its own effort. A name the effort order cannot rank has no step above it, so that row stays too.

The judge's other readings come with it in `judge.alternatives`, best first. They are the second readings of the same task, not mistakes. When the judge was unsure, look at the rows you can see. If one fits your own evaluation better, take it and say so in one line. When nothing fits better, spend the escalated row.

When the judge says nothing, **you** are the one who does not know. The same rule is yours: if you are unsure between two profiles, take the one that asks for more thinking. A task you do on the wrong model costs a redo, and a task you do with too little thinking costs a wrong answer.

## What a profile is for

A profile has two prose fields, and only one of them routes.

- `match` is the routing surface. It names the moment the profile is for, with the nouns a prompt would carry, and one exclusion. Match the task against this line. A profile with no `match` line is invisible to the judge, so you can take it only by name.
- `why` is the rationale, for the human who wrote the config. The resolver never reads it. A `why` line that sounds like a better fit than `match` is not a reason to pick that profile.

A profile states an `effort`, a pinned `model`, or both. The pin wins. The resolver spends the first pinned alias the session can use. Without a pin, the resolver reads the `priority` order and the catalogue. It takes the first allowed model that meets the requirement and records the rung it used. Do not second-guess the rung. The ref that came back is the answer.

A profile may also ask for a second opinion. Its `crosscheck` field names the effort for that opinion, and the profile's own effort applies when it names none. The top-level `crosscheck` list names the models that may serve it, in fallback order. The resolver reads that list in order. It skips a model when any of these is true:

- The model is not in the allowlist.
- The model is the primary.
- The model has no known family.
- The model has the same family as the primary.
- The model does not meet the effort.

The first remaining model is the second opinion. An absent list makes every allowed model a candidate. An empty list means no second opinion.

## The evaluation is about the task, not about difficulty

"Difficult" is a feeling, and it drifts toward whatever sounds most serious. Look at what is in front of you instead. How many files or symbols does the task name? Does the answer have to be right, or only reported? What would a wrong answer cost? Running a command and reading its log is not the work of understanding a subsystem, however serious the wording.

Say the evaluation out loud before you call. If you cannot state it in a line, you do not yet know what the task is, and a guess spends the wrong model.

## A literature or research task takes the better model

A literature, citation, or research task does not go on the cheap profile. A cheap model can return a clean, tidy bibliography whose references do not resolve, or resolve to a different paper. Nothing in the text looks wrong, so a human reading the answer cannot catch it. This is the one task where the cheap model is the wrong model, and it holds however simple the request reads.

## The model string is a closed list

`tools.spectre.routing` returns a ref that it checked against the live catalogue. **Use it exactly as returned**, variant suffix included.

That ref is the whole vocabulary. The user wrote down the models they allow, and the list is usually shorter than what the provider offers. A model outside the list is not in this vocabulary. If nothing in the list fits the task, say so and ask. Do not look in the provider for something better.

Never write a model id from memory. Never assemble one from a provider you remember. Never guess a variant. A string this tool did not return is one nobody checked. Nothing enforces the allowlist at the subagent boundary, so the call can run a model outside it.

This matters more than it sounds. You are choosing what the work costs. A model you invent is a cost nobody agreed to, and the answer does not show the cost.

The order is `priority` in the config, never the order the `models` object happens to have. The top-level `crosscheck` list sets the fallback order for a second opinion. Call `tools.spectre.routing({})` when you need either order: the `models` and `crosscheck` arrays on a `resolved` answer carry both, with the catalogue facts behind each model.

## How to read the four answers

1. **`resolved`.** The `profiles` are the routing table. Read `judge`: `used` names the profile to take, and `skipped` leaves the choice to you. Then spawn on that row's `model.ref`. The answer also carries the allowlist and crosscheck orders, the sources the tool read, the names you asked for, and the judge's answer. `references/answer-shape.md` gives every field.
2. **`setup`.** The project has no config file, and the merged config states no models, no profiles, and no `setup` marker. The answer carries `provider`, the starter `models`, and the starter `profiles`. Show the default to the user, and ask once whether to start from it. If yes, call `routing({ setup: "accepted" })` and route from the answer it gives. If no, call `routing({ setup: "declined" })` and spawn without a model. Do not write `spectre.json` by hand.
3. **`declined`.** The user said no before, and `source` names the file that holds that answer. Do not ask again. Leave `model` off the `subagent` call, so the agent's own model runs the work. Say once that this repository routes on no model. If the user wants routing later, they remove the `setup` key from that file.
4. **`problems`.** The config is there and wrong. `problems` lists every mistake, one per line, and each line names the key. Quote the lines, say routing is misconfigured, then ask whether to continue on the current model. When the models and the priority order are valid, the answer carries `models`. It carries `crosscheck` too when the crosscheck list is valid. Read the order while you fix the profile. Do **not** fall back to a model you remember, and do not retry with a different string.

`model` is optional on the `subagent` tool, so every path spawns something.

## Split the task, do not only delegate

A task that spans several kinds of work is usually three tasks. Evaluate each part on its own, then route each part separately, in parallel where they do not depend on each other. One call gives you every row you need:

```text
const t = await tools.spectre.routing({})

subagent({ agent: t.profiles[1].agent, prompt: "find the call sites", model: t.profiles[1].model.ref })
subagent({ agent: t.profiles[2].agent, prompt: "choose the change",     model: t.profiles[2].model.ref })
```

The rows above are examples. Take the profiles whose `match` lines fit the two parts, not the ones at those positions. A cheap profile is good at the mechanical parts: grep, read, run, and report. Spending the expensive profile on that is waste. Spending the cheap one on the judgement is the failure above. Split the task when the parts differ, and both parts get the model they need.

## References

Load only what the task needs.

| File | Read it when |
| --- | --- |
| `references/answer-shape.md` | You need the exact fields on a profile row, a model row, the crosscheck, or a `problems` answer. |
| `references/subagent-call.md` | You are about to call `subagent`, or you need the model precedence and the agent rules. |
| `references/worked-example.md` | You want one full run from the task statement to the spoken line. |
