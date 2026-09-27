# Working on `tools/`

Read this before declaring or changing a tool's `input` or `output` schema. The
sandbox boundary walks those schemas, and it walks a **small subset** of the
Schema AST. Everything outside that subset is rejected at call time — after
registration succeeded, and on the input and the output side alike.

## The rule

1. **A declared schema describes the JSON shape. It does not enforce anything.**
   The host will not run a check even when it accepts the schema carrying it, so
   a check that matters runs inside `execute` — or in the caller, which is the
   only place that can trust the result anyway.
2. **Prefer the primitive.** A count or a line number is `Schema.Number`. A
   member of a fixed set is `Schema.Literals`. An absent field is
   `Schema.optional`. None of those carry a filter, and none of them break.

## What the boundary accepts

Measured at 2.0.18 — one schema per tool, each called with a value valid for it.

| Declared | Call |
| --------- | ---- |
| `Schema.String`, `Number`, `Boolean` | ok |
| `Schema.Literals([...])` | ok |
| `Schema.Struct`, `Schema.Array`, `Schema.Union`, `Schema.Json` | ok |
| `Schema.optional`, `Schema.optionalKey` | ok |
| `Schema.Int` | rejected: `Invalid arguments for tool` |
| `Schema.Finite` | rejected: `Invalid arguments for tool` |
| `Schema.NonEmptyString` | rejected: `Invalid arguments for tool` |
| `Schema.String.pipe(Schema.refine(...))` | rejected: `Expected <filter>` |
| `Schema.URL` | rejected: `Expected URL` |
| `Schema.Natural` | rejected: `Cannot convert a symbol to a number` |
| `Schema.Trim` | rejected: `self.trim is not a function` |

`Int`, `Finite`, and `NonEmptyString` are the traps: they read as plain schemas
and they are not. The last two are worse — the boundary **crashes** on them with
its own internal error, so the failure names neither the field nor the schema.

A branded *type* is fine while it stays a TypeScript type.
`comments(directory: AbsolutePath)` brands nothing at runtime and never reaches a
schema. Branding it into the schema is what breaks it.

## Prove it with a call

`bun run typecheck` cannot catch any of this — every rejected schema above is
valid TypeScript, and registration logs happily either way. A registration that
logs is not a tool that runs. The only proof is a real call:

```js
const result = await tools.spectre.comments({ targets: ["<file>"] })
```

`AGENTS.md` has the command that starts such a session, and the
`OPENCODE_CONFIG_DIR` isolation it needs. Re-run the measurement when the
supported OpenCode version moves; do not trust this table across a bump.
