# Working on `tools/`

Read this before declaring or changing a tool's `input` or `output` schema. The
sandbox boundary walks those schemas, and it walks a **small subset** of the
Schema AST. Everything outside that subset is rejected at call time, after
registration succeeded, and on the input and the output side alike.

## The rule

1. **A declared schema describes the JSON shape. It does not enforce anything.**
   The host will not run a check even when it accepts the schema carrying it, so
   a check that matters runs inside `execute`, or in the caller, which is the
   only place that can trust the result anyway.
2. **Prefer the primitive.** A count or a line number is `Schema.Number`. A
   member of a fixed set is `Schema.Literals`. An absent field is
   `Schema.optional`. None of those carry a filter, and none of them break.

## What the boundary accepts

Measured at 2.0.18, one schema per tool, each called with a value valid for it.

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
and they are not. The last two are worse. The boundary **crashes** on them with
its own internal error, so the failure names neither the field nor the schema.

A branded *type* is fine while it stays a TypeScript type.
`comments(directory: AbsolutePath)` brands nothing at runtime and never reaches a
schema. Branding it into the schema is what breaks it.

## How `options` becomes a call path

Read at tag `v2.0.18` (`cd9a14a`), not inferred. A tool added through
`ctx.tool.transform` lands in the **same** registry as the builtins. There is no
separate plugin path, and the three fields in `Tool.Options` decide where it
surfaces:

| Declared | Reaches the model as |
| -------- | -------------------- |
| `codemode: false` | a direct tool call, by name |
| `codemode` unset or `true`, no `namespace` | `tools.<name>` in Code Mode |
| `codemode` unset or `true`, plus a `namespace` | `tools.<namespace>.<name>` in Code Mode |

`namespace` is what makes the dotted path: the host joins it to the name as
`<namespace>.<name>`. `pinned: true` keeps a tool's full listing in the catalog
from the first round instead of paging it in, and it is only legal alongside
`codemode: true`.

Two gates, and both are about the **caller**, not the tool:

- A tool is dropped from the catalog when the caller's permission ruleset wholly
  disables `options.permission`, defaulting to the tool's own name.
- Code Mode itself is off when that same ruleset wholly disables `execute`.

There is no branch on subagent versus primary. A subagent's catalog is built from
the same registry, filtered by that agent's merged permission ruleset, so it sees
a namespaced tool exactly when a primary does and nothing has to be granted to it.

The practical consequence: a missing `tools.spectre.*` is almost never a
declaration problem. It is `execute` disabled, a denied `read`, or the one that
actually bites: a different copy of this plugin being the one loaded. Check which
copy before re-reading the declaration.

## Prove it with a call

`bun run typecheck` cannot catch any of this. Every rejected schema above is
valid TypeScript, and registration logs happily either way. A registration that
logs is not a tool that runs. The only proof is a real call:

```js
const result = await tools.spectre.comments({ targets: ["<file>"] })
```

`AGENTS.md` has the command that starts such a session, and the
`OPENCODE_CONFIG_DIR` isolation it needs. Re-run the measurement when the
supported OpenCode version moves; do not trust this table across a bump.
