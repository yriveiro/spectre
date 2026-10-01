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
schema. Branding it into the schema is what breaks it. `Worktree.StrategyID` is
`Schema.brand<Schema.Trim, …>`, so it is unusable here and the brand has to stay
on the TypeScript side.

A brand does not launder what it wraps. `Schema.brand<Schema.Trim, …>` inherits
the `Trim` underneath it, so wrapping a rejected construct in a brand does not
make it legal.

**A `Union` of `Struct`s is inside the subset, and it is the cheapest way to make
the output honest.** `Tool.Info`'s output has to be a `ValueSchema`, which is a
`Codec`, a `StandardSchemaV1`, or a `JsonSchema` — and a bare `Struct` is none of
those on its own, which is why one flat output struct typechecks everywhere and a
`Union` of them is the construct to reach for once the members differ. One
struct per outcome means a field an outcome cannot carry is not on the type at
all, and the `...(x ? { x } : {})` spread that keeps a flat struct honest goes
away with it.

## How `options` becomes a call path

Read at tag `v2.0.21`, not inferred. A tool added through
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

Two filters, and both are about the **caller**, not the tool:

- A tool is dropped from the catalog when the caller's permission ruleset wholly
  disables `options.permission`, defaulting to the tool's own name.
- Code Mode itself is off when that same ruleset wholly disables `execute`.

Wholly disabled means one shape and no other. `whollyDisabled` at
`packages/core/src/tool.ts` is three lines: take the last rule matching the
action, and drop the tool only when that rule is `{resource: "*", effect:
"deny"}`. Re-read at tag `v2.0.21`, so this paragraph and the filter definition
above are current; the schema table further up is still measured at 2.0.18 and
has not been re-run.

**`options.permission` is a label, not a boundary.** It decides whether the tool
is *offered*. It is not consulted again when the tool runs — the call path at
`tool.ts` goes `beforeExecute` straight to `executeTool` with no permission
argument — and a plugin has no way to ask. `PermissionDomain` is `list`, `get`,
`reply` and a hook; there is no `assert`. So:

- Do not split one tool into a read half and a write half to give them different
  permission strings. The string controls visibility, so the split buys two
  catalog entries and no safety, and the write half is reachable by anyone who
  can see the read half.
- A tool that mixes reading and mutating is one tool. `tools.spectre.worktrees`
  is that: `action: "list" | "start" | "remove"` under one `permission`, and the
  refusals live in `execute`.
- What actually refuses is the code in `execute`. An input that cannot express
  the dangerous case — no `force` field at all, rather than one defaulting to
  false — is a stronger boundary than any permission string, because it holds
  however the tool was reached.

There is no branch on subagent versus primary. A subagent's catalog is built from
the same registry, filtered by that agent's merged permission ruleset, so it sees
a namespaced tool exactly when a primary does and nothing has to be granted to it.

Every tool in this plugin declares `namespace: "spectre"`, and the dotted path
depends on it, so it is the first thing to check when a path does not resolve.
Nothing enforces it: a tool added without a namespace lands at `tools.<name>`,
typechecks, and registers without complaint. `test/tools/reachable.test.ts`
asserts every registered tool carries the namespace, which is what stops the next
one from being added without it.

The practical consequence: a missing `tools.spectre.*` is almost never a
declaration problem. It is `execute` disabled, the tool's own permission wholly
disabled, or the one that actually bites: a different copy of this plugin being
the one loaded. Check which copy before re-reading the declaration.

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

There is no cheap pre-check for this table, and it is worth saying why rather than
leaving the gap. The accepted set is decided by a walk of the Schema AST inside
the host, and on Effect `4.0.0-rc.112` that AST carries no `_tag` on the nodes a
schema is built from — `Schema.Struct({a: Schema.String})` exposes
`fields`, `mapFields`, `ast`, `rebuild`, and friends, and `ast._tag` is the
description `"Objects"` rather than a type name. A script that walks for tags
therefore finds nothing and reports success, which is worse than having no check:
it is a check that cannot fail. Read the table, keep to the primitives, and let
the real call be the proof.
