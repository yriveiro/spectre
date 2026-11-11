# A worked example

This page runs one task from the evaluation to the spoken line. The refs are placeholders. The routing tool returns the real strings.

## The task

> Run the test suite and tell me what failed.

## Evaluate

> One command, one log to read, and the deliverable is a report. Nothing to decide, so the profile whose `match` names a command and a log.

## Ask

```text
const t = await tools.spectre.routing({ task: "run the test suite and tell me what failed" })
// t.status === "resolved"
// t.judge: { status: "used", profile: "mechanical", confidence: 0.93 }
// t.profiles: [{ name, match, effort, agent, model: { ref, rung, … }, … }, …]
```

## Choose

```text
const picked = t.judge.status === "used" ? t.judge.profile : "mechanical"
const mechanical = t.profiles.find((one) => one.name === picked)
```

The judge chose `mechanical` at 0.93 confidence. Take that row. Do not pick a model yourself.

## Spawn

```text
subagent({
  agent:       mechanical.agent,
  description: "Run tests, report failures",
  prompt:      "Run the test suite. Report which tests failed and why, quoting the first failing assertion. If everything passes, say so plainly.",
  model:       mechanical.model.ref,
})
```

## Say

> Routed to `mechanical` on `<provider>/<model>#<rung>`. The judge chose it at 0.93 confidence. One command and one log, no judgement needed.

## A skipped judge

When `judge.status` is `skipped`, read `reason`, then pick the profile from the `match` lines yourself. The rest of the run is the same:

> Routed to `mechanical` on `<provider>/<model>#<rung>`. The judge was skipped, so I picked it from the `match` lines. One command and one log.

One line, because a model choice nobody hears about looks like a mistake once it turns out to be one.
