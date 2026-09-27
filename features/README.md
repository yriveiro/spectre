# Features

Notes for things we design now and build later. Each file is a decision record:
what we decided, what we checked for real, and what is still open.

| File | Status | In one line |
| ---- | ------ | ----------- |
| [model-routing.md](./model-routing.md) | designing | A `spectre.jsonc` file. It lists profiles. Each profile pins a model, some tools, and some permissions. |
| [arena.md](./arena.md) | reserved, not built | Run the same question on several models at once. The main chat picks the best answer. |

## How the two files fit together

`arena.md` does **not** need to exist before we build `model-routing.md`. The arena
just uses the profiles. That order matters, so here it is in one picture.

```
                    spectre.jsonc
                          │
              ┌───────────┴───────────┐
              │      profiles[]       │   ← everything keys off the name
              │  (name → the body)    │
              └───────────┬───────────┘
        ┌──────────┬───────┴───────┬──────────────┐
        ▼          ▼               ▼              ▼
    agents/     skills/          tools/        arena/ (later)
    pin the     attach the       give it the    run several
    model +     method skill     tools it       of them, main
    rights      for that         needs          chat decides
                profile
```

Four parts of spectre read the same list of profiles. Nothing is written twice.
The arena is just the fourth reader of a list we already have, which is why we can
leave it for later without blocking anything.

**The mistake to avoid:** one of those parts going around the profile and reading
the config file directly for something that is not on the profile — a model string,
say, or a tool list. The moment that happens, the config file turns back into a
private settings file for `agents/`, and the arena suddenly needs its own model
logic.
