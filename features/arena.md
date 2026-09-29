# Arena (later, not built yet)

Status: reserved. On purpose this comes **after**
[model-routing.md](./model-routing.md). Nothing here blocks that file, and nothing
in that file should be bent to fit this one.

The skill `skills/definitions/arena/` already exists and is not this feature.
Which of the two gives way is recorded in
[FOR_AGENTS.md](../skills/FOR_AGENTS.md), rule 3. Everything below is about the
feature.

## What it does

Run the same question on several spectre agents using **different models**. Let
each answer on its own. The **main chat** then picks the best answer.

The rule from your request: the arena uses the profiles from the config file. The
config file is not being built *for* the arena, and the arena does not get its own
model logic.

## The one rule

**An arena is a list of profile names.** It goes through the same list the
`agents` part already reads.

```jsonc
{
  "arena": {
    "candidates": ["explorer", "paper"],
    "max_candidates": 3,
    "judge": "main"
  }
}
```

That is the whole surface. Turning a profile name into a real model is work the
`agents` part already does for every other profile.

If the arena ever has to write `anthropic/claude-opus-4-1#high` directly, something
has gone wrong: the two features have quietly merged.

## Two ways to run several at once

|  | `task` with `background: true` | `ctx.generate.text({ prompt, model })` |
| --- | --- | --- |
| Sessions | N real child sessions | none |
| Tools | the agent's full toolset | none |
| Permission prompts | N of them | none |
| Model | comes from the profile | you pass it in the call |
| Cost | N full agent runs | N single calls |
| Depth limit | hits `subagent_depth` (default 1) | not affected |

**Both profiles we have need tools.** `explorer` needs glob, grep, read. `paper`
needs web search and a place to write. So the arena is the `task` path.

`generate.text` is not wasted. It is the right tool for a cheaper, different kind
of arena, one where the models just give opinions instead of doing work ("three
opinions on this design, pick one"). Keep it in the design vocabulary for that.

### Two gates on the subagent path

1. **Background is switched on in your setup, so this one is fine.** Background
   needs `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true`; without it every
   candidate would block and there would be no fan-out at all. *(Unverified at
   2.0.18: no `background_subagents` string in `packages/core/src` at that tag.
   Check it against the tag before this file is built.)*
2. **`subagent_depth` defaults to 1** (`packages/core/src/tool/plugin/subagent.ts:129`,
   at v2.0.18). A candidate that itself spawns (`paper` running `verifier`) will
   hit that wall. So either we raise the depth, or the verifier runs inside the
   same agent instead of as a subagent. Note the key moved: it is
   `experimental.subagent_depth` at 2.0.18, not top-level `subagent_depth`, and
   `config/normalize.ts:46` treats the top-level spelling as unsupported.
   **This is the sharpest knot between the arena and the paper profile, and it is
   not solved yet.**

## The judge is the main chat

Worth saying out loud: the judge's model is whatever model you are chatting with
right now. `spectre` is a primary agent with no model pinned, so it inherits yours.
`spectre.jsonc` does **not** control how good the judge is.

That is fine, and free, and the judge already has the whole conversation. It is
just not visible anywhere, so here it is in writing.

If the judge ever needs to be a *different* model from the one you are chatting
with, `ctx.generate.text` does it: put the candidates' answers into one prompt and
send it to the model you want.

## What it costs

N candidates on expensive models, plus an expensive judge, is **N + 1 expensive
runs**. Three candidates is four.

`max_candidates` is there so this cannot quietly become a ten-model bill. It gets
checked at startup.

## What the judge gets to see

All N answers, unedited, in the main chat's context. Two things to plan for rather
than discover:

1. **Context fills up fast.** Three paper summaries will fill a window. The judge
   needs the **verdicts**, not the essays. So candidates should return the same
   fixed shape every time: claim, evidence, confidence, instead of prose. That
   shape belongs in the profile from the start, not bolted on when the arena
   arrives.
2. **They will agree for the wrong reasons.** Two candidates on the same model have
   the same blind spots, so their agreement proves very little. That is the whole
   point of the feature, so a config listing three profiles that all use the same
   model in `models` is a bug. The loader should be able to warn about it.

## Open questions

1. Judge is the main chat, or its own profile on a pinned model? Main chat for now,
   as asked.
2. Do candidates run at the same time for real, or do we approve the whole set's
   permissions first and then go?
3. If a candidate fails or times out, do we drop it quietly or say so?
4. Does the judge get told which model wrote each answer? Hiding it is probably
   better. It stops "opus said so" from settling a tie. But it costs you the
   trail you need when a verdict looks wrong.
