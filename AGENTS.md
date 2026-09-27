# AGENTS.md

Working notes for anyone — human or agent — changing this repository.

## What this repo is

Spectre is an OpenCode plugin. The whole package is one entrypoint: `index.ts`
default-exports a plugin definition (`id` + `effect`), and OpenCode calls `effect`
once per project instance. Everything Spectre adds to OpenCode — skills, agents,
tools, nested plugins, MCP servers — is registered from inside that `effect`,
through the domains on the plugin context.

Minimum supported OpenCode version: **2.0.18**. The installed CLI is the only
runtime; there is no build step, and TypeScript source is shipped as-is.

## Runtime: Bun first

OpenCode ships as a Bun standalone executable, so this plugin runs on Bun. **Reach
for the Bun API first. Use a Node API only when Bun has no equivalent.**

The replacements below were read off `docs/runtime/bun-apis.mdx` in the Bun
repository and then confirmed at runtime on Bun 1.4.2 (the version OpenCode ships
and the version this plugin runs on). Do not add a dependency for anything in
this table.

| Reach for | Use instead |
| --------- | ----------- |
| `node:fs`, `node:fs/promises` | `Bun.file`, `Bun.write`, `Bun.stdin/stdout/stderr` |
| glob libraries (`fast-glob`, `tinyglobby`) | `Bun.Glob` |
| `node:child_process` | `Bun.spawn`, `Bun.spawnSync`, `Bun.$` |
| `node:os` | `Bun.env`, `Bun.main`, `Bun.version`, `Bun.revision`, `Bun.which` |
| `node:crypto` | `Bun.password`, `Bun.hash`, `Bun.sha`, `Bun.CryptoHasher`, Web Crypto |
| `uuid` | `Bun.randomUUIDv7` |
| `node:zlib` | `Bun.gzipSync`/`gunzipSync`/`deflateSync`/`inflateSync`, `Bun.zstd*` |
| `node:http`, `node:https` | `fetch`; `Bun.serve`, `Bun.listen`, `Bun.connect`, `Bun.udpSocket` to serve |
| `node:dns` | `Bun.dns.lookup`, `Bun.dns.prefetch` |
| `node:tls` | `fetch` / `Bun.serve` with TLS options |
| `node:stream` | `Bun.readableStreamToText/JSON/Array/Blob/Bytes` |
| `Buffer` | `Uint8Array`, `TextEncoder`, `Bun.ArrayBufferSink`, `Bun.allocUnsafe`, `Bun.concatArrayBuffers` |
| `node:util` `inspect` | `Bun.inspect`, `Bun.peek`, `Bun.deepEquals`, `Bun.deepMatch` |
| `node:timers/promises` `setTimeout` | `Bun.sleep`, `Bun.sleepSync`, `Bun.nanoseconds` |
| `semver` | `Bun.semver` |
| TOML parsers | `Bun.TOML.parse` |
| `chalk`, `ansi-colors` | `Bun.color` |
| markdown renderers | `Bun.markdown` |
| XML parsers | `Bun.XML` |
| `escape-html` | `Bun.escapeHTML` |
| `string-width` | `Bun.stringWidth` |
| line splitting | `Bun.indexOfLine` |
| image codecs | `Bun.Image` |
| `better-sqlite3` | `bun:sqlite`, `Bun.SQL` |
| `ioredis` | `Bun.RedisClient`, `Bun.redis` |
| `node:test` | `bun:test` |
| CSRF libraries | `Bun.CSRF` |
| cookie helpers | `Bun.Cookie`, `Bun.CookieMap` |
| `worker_threads` | `Worker` |
| esbuild / swc | `Bun.build`, `Bun.Transpiler` |
| `node:path` | `import.meta.dir`, `import.meta.path`, `Bun.file().name`, `Bun.pathToFileURL`, `Bun.fileURLToPath`, `Bun.resolveSync` |
| `process` (where avoidable) | `Bun.env`, `import.meta` |

Three names look like they should exist and do not. Confirmed absent at runtime
and absent from the API table:

- **`Bun.path` does not exist.** The path helpers are `Bun.pathToFileURL`,
  `Bun.fileURLToPath`, `Bun.resolveSync`, plus `import.meta.dir` /
  `import.meta.path`. For real path manipulation (`join`, `relative`, `extname`)
  Bun has no equivalent, so `node:path` is the correct answer — Bun implements it
  fully. Use it without apology and record it as an exception below.
- **`Bun.Blob` and `Bun.File` do not exist.** Use the standard `Blob` / `File`
  globals, or `Bun.file()` for filesystem work. Bun's own guidance is to build on
  the standard Web APIs rather than namespace them.

To re-verify after a Bun upgrade, probe by direct property access — `n in Bun`
reports `false` for lazily-defined members and will lie to you:

```sh
bun -e 'for (const n of ["path","Blob","Glob","sleep"]) console.log(n, typeof Bun[n])'
```

Rules that follow from this:

- Do not add a Node dependency for something Bun already does natively.
- Every approved `node:*` import is a deliberate exception. Keep the list in this
  file current, with the reason, so the next reader can tell an exception from a
  slip.

### Approved `node:*` exceptions

| Import      | Why Bun has no equivalent |
| ----------- | ------------------------- |
| `node:path` | Only `join` and `relative`. Checked against `docs/runtime/`: the complete set of Bun path utilities is `Bun.fileURLToPath`, `Bun.pathToFileURL`, and `Bun.resolveSync`, none of which join, split, or relativize. `Bun.$`'s `dirname`/`basename` are shell binaries, not functions. Two files import it: `skills/definitions/definition.ts`, whose `SKILL.md` anchor is `join(import.meta.dir, "SKILL.md")`, and `tools/definitions/comments.ts`, which resolves a target against the project directory and reports every hit back as a project-relative path. |

## Writing the entrypoint

Follow the official Effect plugin docs, not a local preference:
<https://opencode.ai/v2/docs/build/plugins/effect/>. The canonical shape is a
value import of `Plugin` from the barrel, `Plugin.define`, and an `effect` that
is a plain function returning `Effect.gen`:

```ts
import { Plugin } from "@opencode/plugin/effect"
import { Effect } from "effect"

export default Plugin.define({
  id: "spectre",
  effect: (ctx) =>
    Effect.gen(function* () {
      // register skills, agents, tools, MCP servers, ...
    }),
})
```

`@opencode/plugin` is a **runtime** `dependency` of a published plugin, alongside
`effect` — that is what the docs' Publish section prescribes. An earlier version
of this file argued for a type-only import to avoid pulling the `@opencode/*`
tree in at install time. That reasoning was wrong on the merits: the dependency is
supposed to be there, and because we pin `effect` to the same exact version
`@opencode/plugin` resolves to, the package manager dedupes them into a single
copy. Check that dedupe still holds after any version bump:

```sh
find node_modules -path '*effect/package.json' | grep -c .
```

Anything above `1` means two Effect copies, which is the hazard worth worrying
about — not the dependency count.

Prefer `Effect.gen` over `Effect.fn` here. The docs use `Effect.gen` throughout,
and the `effect` signature is `(ctx) => Effect`, so a generator that takes `ctx`
directly is the shape OpenCode expects.

`tsconfig.json` sets `"types": ["node", "bun"]` deliberately. Dropping `"node"`
to leave a tidy `["bun"]` typechecks fine until you touch a Bun API that needs
node's ambient declarations — `Bun.Blob` and the `BunFile` type both stop
resolving. Both entries are load-bearing: `bun` supplies the Bun globals, `node`
supplies the ambient declarations and `node:*` compatibility that Bun implements.

## Layout and how OpenCode finds the entrypoint

`index.ts` sits in the **repository root** and is the package's `.` export:

```json
"exports": { ".": "./index.ts" }
```

The root placement is what lets one file satisfy both of OpenCode's resolution
paths, with no build step and no `dist`:

| Referenced as | Resolved via | Requirement |
| ------------- | ------------ | ----------- |
| package / `github:` spec | `exports["./server"]`, then `exports["."]` | one of the two must exist |
| absolute **directory** in config | `<dir>/server.*`, then `<dir>/index.*` | a root-level `index.*` or `server.*` |
| absolute **file** in config | rejected | logs `configured plugin path must be a directory` |

Moving the entrypoint to `src/index.ts` would still install from a git specifier —
resolution goes through the exports map, not the file location — but it would stop
a local **directory** reference from resolving, and OpenCode drops unresolved
directory plugins **silently** (`if (!entrypoints.server) return []`). Keeping
`index.ts` at the root means both paths work, so local iteration needs no mirror:

```json title="opencode.json"
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/absolute/path/to/spectre"]
}
```

Ship TypeScript source as-is. Do not introduce a `dist`, a bundler, or a `prepare`
script: a git install runs no build, so a `dist` that is not committed is a
package that cannot load.

## Version pins

These are exact pins, not ranges, and they are not incidental:

- `effect` is pinned to the exact build OpenCode ships (`4.0.0-rc.112` at
  2.0.18). The plugin's `effect` values are handed straight to OpenCode's Effect
  runtime, so a different major/minor is a real hazard, not a style choice.
- `@opencode/plugin` tracks the OpenCode version whose plugin contract we target.
- `@opencode/schema` is pinned to the same version, because `skills/definitions/`
  imports `AbsolutePath` from it directly rather than through the plugin barrel.
  Two copies of the same schema is the hazard: brand values made by one copy are
  not interchangeable with the other.
- Bump both together with the supported-version floor in `package.json`, then
  prove no straggler of the old version survives anywhere:

  ```sh
  grep -rn '<old-version>' --include='*.json' --include='*.md' --include='*.ts' . \
    | grep -v node_modules   # expect no hits
  ```

Before changing any of them, check what the target OpenCode tag actually pins
(`packages/*/package.json` → `workspaces.catalog` at that tag). The `effect` pin
is the one that moves least; read it rather than assuming it tracks the release.

## Checks

```sh
bun install
bun run typecheck
```

Verify a change actually loads, from a scratch project rather than this repo:

```sh
opencode plugin list
```

`opencode plugin list` reports nothing on the first run in a fresh directory —
the background service has not picked up the config yet. Re-run it before
concluding anything failed.

`opencode plugin list` only proves the entrypoint resolved. To prove the `effect`
ran, and that what it registers is what you think, start a session with the logs
turned on and read the plugin's own log lines:

```sh
OPENCODE_CONFIG_DIR=/tmp/empty-cfg opencode run --standalone --log-level info --print-logs \
  'reply with the single word: ok'
```

`OPENCODE_CONFIG_DIR` does **not** achieve that on its own, which is worth knowing
before you trust a session. Measured at 2.0.18: with the directory pointed at an
empty folder and a scratch project listing only the checkout, `opencode plugin
list` still reported both copies.

```
ID                VERSION  SOURCE
yriveiro.spectre  local    /Users/.../spectre/index.ts
yriveiro.spectre  3ac06f1  github:yriveiro/spectre
```

The `github:` specifier is resolved from the install cache, not from the config
directory, so an empty `OPENCODE_CONFIG_DIR` does not unseat it. The only thing
that does is removing the entry from the global config — `~/.config/opencode/opencode.jsonc`:

```jsonc
{
  "plugins": ["github:yriveiro/spectre"]   // delete this line while developing
}
```

Until it is gone, both copies claim the id `yriveiro.spectre` and the installed
one wins, and it wins silently: a published copy from before this tool existed
registers no `comments` tool at all, so `tools.spectre.comments` is simply absent
from the catalog and every symptom looks like a bug in the code under test. Check
which copy is live before debugging anything.

A log line that says a domain registered is not proof that what it registered
runs. `opencode plugin list` resolves an entrypoint; a session proves the
`effect`. For a tool, the proof is a call — see `tools/FOR_AGENTS.md`, which
holds the sandbox boundary's rules for `input` and `output` schemas and the
command that proves one.
