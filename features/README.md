# Features

Notes for things we design now and build later. Each file is a requirements
document: what the feature must do, the platform facts it relies on with a source
for each, and what is still open. It is not a log of how the design was reached.

| File | Status | In one line |
| ---- | ------ | ----------- |
| [model-routing.md](./model-routing.md) | built | A `spectre.jsonc` file. It whitelists models and names the reasons to pick one. A profile resolves to a model string for a `subagent` call, not an agent body. |
| [data-root.md](./data-root.md) | built | Where a skill writes when the output has to outlive the session. The path shape, the permission that covers it, and who writes there. |
| [arena.md](./arena.md) | reserved, not built | Run the same question on several models at once. The main chat picks the best answer. |

The skill `skills/definitions/arena/` shares this file's name and is not the same
thing. The collision, and which one gives way, is recorded once in
[FOR_AGENTS.md](../skills/FOR_AGENTS.md), rule 3.

## How the two files fit together

`arena.md` does **not** need to exist before we build `model-routing.md`. The arena
just uses the profiles. That order matters, so here it is in one picture.

```
                    spectre.jsonc
                          │
              ┌───────────┴───────────┐
              │  models{}  whitelist   │   ← every string checked on each call
              │  profiles{}  name→why  │   ← the router's vocabulary
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
