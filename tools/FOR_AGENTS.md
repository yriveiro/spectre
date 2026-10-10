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

Measured at 2.0.26: one tool per construct, each called once with a value valid
for it. The boundary walks the schema, so what this table lists is what a
declaration can say and have honoured.

| Declared | Call |
| --------- | ---- |
| `Schema.String`, `Number`, `Boolean` | ok |
| `Schema.Literals([...])` | ok |
| `Schema.Struct`, `Schema.Array`, `Schema.Union`, `Schema.Json` | ok |
| `Schema.optional`, `Schema.optionalKey` | ok |
| `Schema.Int`, `Schema.Finite`, `Schema.Natural` | ok |
| `Schema.NonEmptyString` | ok |
| `Schema.String.pipe(Schema.refine(...))` | ok |
| `Schema.Trim` | ok |
| `Schema.URL` | rejected: `Expected URL` |

`Schema.URL` is the only rejection measured, and it is not a JSON Schema problem:
`Schema.toJsonSchemaDocument(Schema.URL)` emits a plain `{"type":"string"}`
alongside every other row here, so the refusal comes from somewhere else in the
call path. It emits a string schema and is still refused, which is the one row
in this table whose cause is not established.

`Int`, `Finite`, `Natural` and `NonEmptyString` were **rejected outright** at
2.0.18, and the host honours them now. A second session called each one with a
value it must reject — `1.5`, `NaN`, `-3`, `""` — and every one refused, so the
boundary validates them rather than ignoring them and passing the value through.

**The cause is in `packages/core/src/tool/runtime.ts:172` at 2.0.26**, and it is
the reason this table changed. The boundary used to walk the Effect schema AST
itself, and on `effect@4.0.0-rc.112` that AST carries no `_tag` on the nodes a
schema is built from, so everything past the primitives failed. It now calls
`Schema.toJsonSchemaDocument`, which is Effect's own emission. That is why six
rows turned from rejected to ok across two bumps with no change here.

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

Read at tag `v2.0.26`, not inferred. A tool added through
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
"deny"}`. Re-read at tag `v2.0.26`, so this paragraph and the filter definition
above are current. The schema table further up is still measured at 2.0.18 and
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
supported OpenCode version moves. Do not trust this table across a bump.

There is no cheap pre-check for this table, and the reason changed with it. Until
2.0.26 the host decided the accepted set with a walk of the Schema AST, and on
Effect `4.0.0-rc.112` that AST carries no `_tag` on the nodes a schema is built
from — `Schema.Struct({a: Schema.String})` exposes `fields`, `mapFields`,
`ast`, `rebuild`, and friends, and `ast._tag` is the description `"Objects"`
rather than a type name. A script that walked for tags found nothing and reported
success, which is worse than having no check: a check that cannot fail.

That walk is gone. `Schema.toJsonSchemaDocument` is what converts a schema now,
and it runs in this repository's own process, on the same `effect@4.0.0-rc.112`.
So the pre-check that could not be written can be written:

```js
import { Schema } from "effect";
console.log(JSON.stringify(Schema.toJsonSchemaDocument(Schema.Int).schema));
// {"type":"integer"}
```

What it cannot settle is the last step. The boundary still validates the caller's
JSON against that document somewhere the conversion does not reach, which is why
`Schema.URL` emits `{"type":"string"}` and the host refuses it. Use it to see what
a declaration says, and let the real call prove what the host does with it.

## The dictionary export

`tools.spectre.prose` reads the lexical half of ASD-STE100 from a JSON export the
reader produced from their own copy of the specification. `spectre.jsonc` names the path
under `dictionary`, and a relative one resolves against the config file that named it.

The export is **not in this repository**. Issue 9, page 2 restricts reproduction of the
dictionary to eight categories of organisation, and this project is in none of them. The
config carries a path, the tool reads the file at the path, and nothing here holds a word
list. Anyone who wants the lexical half requests the standard from
[asd-ste100.org](https://www.asd-ste100.org/STE_downloads.html) and exports it.

The shape the tool reads, with the fields it uses marked:

```jsonc
{
  "meta": {
    // Reported back so a caller can say which issue it ruled against.
    "issue": "9 (2025-01-15)",
    "source_url": "https://www.asd-ste100.org/assets/files/ASD-STE100_ISSUE9.pdf",
    "copyright": "© ASD, 2025 – All rights reserved",
  },
  "entries": [
    {
      // The headword carries the part of speech, the way the dictionary prints it:
      // `CHECK (n)`. A lookup strips the marker, so `check` finds this entry.
      "headword": "CHECK (n)",
      "pos": "n",
      // UPPERCASE in the source means approved. The export says so as a boolean, and
      // a missing flag is read as approved, which is the safe default for a word the
      // dictionary lists at all.
      "approved": true,
      "meaning": "an inspection",
      "page": "2-1-C2",
      // The approved replacements, for a word that is not approved.
      "alternatives": [{ "word": "ATTACH", "pos": "v" }],
      "senses": [
        { "meaning": "an inspection", "ste": "Do a check.", "non_ste": "" },
      ],
    },
  ],
}
```

`senses`, `annotation`, `forms`, `raw` and `replacement_hint` are read as present or absent
and not otherwise. `senses[].non_ste` is the example of the misuse the standard warns
about, and the tool does **not** turn it into a rule: a word can be approved and still be
wrong in context, which is `meaning-fidelity`'s subject rather than a lookup's.

Two readings that are worth stating because both are decisions rather than defaults:

- **A word with no entry is `unknown`, not `not-approved`.** A word missing from the export
  may be a technical noun the reader declared, and STE rule 1.5 hands those to the project.
  Reporting it as a violation would be wrong more often than right.
- **An entry with no part of speech answers any part of speech.** A ruling for the word
  itself is not a ruling for one use of it.
