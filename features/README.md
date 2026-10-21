# Features

Notes for things we design now and build later. Each file is a requirements
document: what the feature must do, the platform facts it relies on with a source
for each, and what is still open. It is not a log of how the design was reached.

| File | Status | In one line |
| ---- | ------ | ----------- |
| [model-routing.md](./model-routing.md) | built | A `spectre.json` file (`spectre.jsonc` still reads). It whitelists models and states the effort each profile needs. The resolver turns that effort into a model string for a `subagent` call, not an agent body. |
| [routing.md](./routing.md) | Phase A built | A profile states the effort a task needs, not a model id. The model is resolved at call time from the allowlist and the live catalogue. The page, the corpus and the judge are not. |
| [data-root.md](./data-root.md) | built | Where a skill writes when the output has to outlive the session. The path shape, the permission that covers it, and who writes there. |
| [arena.md](./arena.md) | reserved, not built | Run the same question on several models at once. The main chat picks the best answer. |
| [session-return.md](./session-return.md) | built, unverified live | A session whose worktree was collected moves itself back to main and is told what happened to its work. No fetch: the user updates main. |
| [canvas.md](./canvas.md) | built | A standalone HTML page saved outside the project and opened for a human. A PR canvas is that page built from a real diff, so a reviewer can reach the hunk a claim is about. |
| [code-hardness.md](./code-hardness.md) | evidence, not built | What the literature says about hard code, what this repository already measures, and the four changes the evidence asks for. |

The skill `skills/definitions/arena/` shares this file's name and is not the same
thing. The collision, and which one gives way, is recorded once in
[FOR_AGENTS.md](../skills/FOR_AGENTS.md), rule 3.

## How the two files fit together

`arena.md` does **not** need to exist before we build `model-routing.md`. The arena
just uses the profiles. That order matters, so here it is in one picture.

```
                    spectre.json
                          │
              ┌───────────┴───────────┐
              │  models{}  whitelist   │   ← every string checked on each call
              │  profiles{}  name→effort  │   ← the router's vocabulary
              └───────────┬───────────┘
        ┌──────────┬───────┴───────┬──────────────┐
        ▼          ▼               ▼              ▼
    skills/     agents/          tools/        arena/ (later)
    the router  the bodies:      reads the     run several
    picks a     prompt, perms,   config and    of them, main
    profile     skills, tools     returns      chat decides
```

The split that matters: **the config decides what a call costs, the agent decides
what it may do.** Profiles carry no permissions, because permissions are an agent
body property and a profile is not a body. A profile that needs a different write
scope names a different `agent`. That is the escape hatch, not a config key.

Three parts of spectre read the same config. Nothing is written twice. The arena is
just the third reader of a list we already have, which is why we can leave it for
later without blocking anything.

**The mistake to avoid:** one of those parts going around the config and reading it
directly for something that is not on a profile, such as a model ref or an agent
name. The moment that happens, the config file turns back into a private settings
file for `agents/`, and the arena suddenly needs its own model logic.
