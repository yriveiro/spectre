# Working on `tools/`

Read this before changing a tool's `input` schema, `output` schema, or `options`.

## Schema rules

OpenCode 2.4.2 runs two separate steps on every tool schema (`packages/core/src/tool/runtime.ts`):

1. `Schema.toJsonSchemaDocument` emits the JSON Schema shown to the model (`runtime.ts:187`). For `Schema.Int`, the host strips Effect's safe-integer `minimum` and `maximum` bounds (`runtime.ts:196-208`).
2. `Schema.decodeUnknownEffect` validates the incoming JSON payload at call time (`runtime.ts:79`).

Because JSON Schema only describes the tool while Effect's decoder enforces the runtime type, **never use a schema whose TypeScript type is a class instance**. A JSON payload cannot carry an instance, even when JSON Schema advertises `{"type":"string"}`.

| Schema | JSON Schema shown to model | JSON input at call time |
| ------ | -------------------------- | ----------------------- |
| `Schema.String`, `Number`, `Boolean` | primitive | accepted |
| `Schema.Literals([...])` | enum | accepted |
| `Schema.Struct`, `Schema.Array`, `Schema.Union`, `Schema.Json` | object / array / union | accepted |
| `Schema.optional`, `Schema.optionalKey` | optional field | accepted |
| `Schema.Int`, `Schema.Finite`, `Schema.Natural`, `Schema.NonEmptyString` | integer / number / string | accepted and validated |
| `Schema.Trim` | `{"type":"string"}` | accepted and trimmed |
| `Schema.String.pipe(Schema.refine(...))` | `{"type":"string"}` | accepted and validated |
| `Schema.URL`, `Schema.Date`, `Schema.BigInt`, `Schema.URLSearchParams`, `Schema.Uint8Array`, `Schema.FormData` | string or array | **refused** |

Follow three rules when declaring schemas:

- **Prefer primitives and literals.** Use `Schema.String`, `Schema.Number`, `Schema.Int`, `Schema.Literals([...])`, and `Schema.optional`.
- **Keep brands in TypeScript, not in tool schemas.** A runtime brand inherits its wrapped schema (for example, `Worktree.StrategyID` wraps `Schema.Trim`).
- **Use a `Schema.Union` of `Schema.Struct`s for multi-outcome outputs.** Give each outcome its own struct so impossible fields do not exist on the type.

## Host singletons and `Tool.Error`

OpenCode redirects only `effect` and `@opencode/plugin` to its own runtime (`@opencode/plugin/dist/runtime-modules.js` at 2.4.2). It does not redirect `@opencode/schema`.

The host checks `error instanceof Tool.Error` (`packages/core/src/tool/runtime.ts:51`). If a tool throws `Tool.Error` imported from `@opencode/schema`, `instanceof` fails and the host drops `metadata` and `error`.

- Import `Tool` and every barrel-re-exported domain from `@opencode/plugin/effect` (see `@opencode/plugin/dist/effect/index.d.ts`).
- Import `AbsolutePath`, `Session`, `SessionMessage`, `Goal`, and `Money` from `@opencode/schema/*` because the barrel does not re-export them.

## `Tool.Options` and Code Mode paths

Tools registered through `ctx.tool.transform` join the same registry as builtins. `Tool.Options` controls how the model reaches a tool:

| Options | Call path |
| ------- | --------- |
| `codemode: false` | direct tool call by name |
| `codemode` unset or `true`, no `namespace` | `tools.<name>` in Code Mode |
| `codemode` unset or `true`, `namespace: "spectre"` | `tools.spectre.<name>` in Code Mode |

- **Set `namespace: "spectre"` on every Spectre tool.** `test/tools/reachable.test.ts` fails if any registered tool omits it.
- **Omit `pinned: true` (both top-level and under `options.codemode`).** Keeping `tools.spectre.*` unpinned keeps `CodeModeCatalog` inside `INLINE_BUDGET = 2_000` (`packages/core/src/codemode/catalog.ts:50`).
- **Keep line one of `description` at 120 characters or fewer** (`DESCRIPTION_LIMIT = 120`). Aim for 40 to 85 words for BM25 ranking, and place field contracts in `.annotate({ description })`.
- **Treat `options.permission` as a visibility label, not a security boundary.** OpenCode checks `options.permission` when building the catalog (`isActionDenied` in `packages/core/src/permission/policy.ts:166-169`, `packages/core/src/tool.ts:389-418`), not when running `execute`. Keep read and write actions in one tool (like `tools.spectre.worktrees`), enforce refusals in `execute`, and call `ctx.permission.assert` when an action needs user approval.
- **Subagents inherit the same registry.** No extra grant is needed for subagents beyond their permission ruleset.

## Verify schema and reachability

`bun run typecheck` does not catch runtime decode refusals. Check Effect's decoder and JSON Schema output locally on the pinned `effect@4.1.0`:

```js
import { Schema } from "effect";
Schema.toJsonSchemaDocument(MyInput).schema;
Schema.decodeUnknownOption(MyInput)(samplePayload)._tag; // "Some"
```

Local decoding proves the schema accepts JSON payloads. To prove live registration and reachability, follow `VERSIONING.md`. Remove `"github:yriveiro/spectre"` from `~/.config/opencode/opencode.jsonc` first so the cached copy does not shadow your checkout.

For `tools.spectre.prose` dictionary export format, see `tools/definitions/prose/DICTIONARY.md`.
