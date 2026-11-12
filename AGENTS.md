# AGENTS.md

Working notes for anyone (human or agent) changing this repository.

## What this repo is

Spectre is an OpenCode plugin. The whole package is one entrypoint: `index.ts`
default-exports a plugin definition (`id` + `effect`), and OpenCode calls `effect`
once per project instance. Everything Spectre adds to OpenCode (skills, agents,
tools, commands) is registered from inside that `effect`,
through the domains on the plugin context.

Minimum supported OpenCode version: **2.2.7**. The installed CLI is the only
runtime. There is no build step, and TypeScript source is shipped as-is.

## Runtime: Bun first

OpenCode ships as a Bun standalone executable, so this plugin runs on Bun. **Reach
for the Bun API first. Use a Node API only when Bun has no equivalent.**

The replacements below were read off `docs/runtime/bun-apis.mdx` in the Bun
repository, confirmed at runtime on Bun 1.4.2, and re-probed on 1.4.4 — the
version OpenCode ships at 2.2.7 (`packageManager` in its root `package.json` and
`.github/workflows/release.yml`) and the version this plugin runs on. Do not add a dependency for
anything in this table.

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
| JSONC parsers (`jsonc-parser`) | `Bun.JSONC.parse` |
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
  Bun has no equivalent, so `node:path` is the correct answer. Bun implements it
  fully. Use it without apology and record it as an exception below.
- **`Bun.Blob` and `Bun.File` do not exist.** Use the standard `Blob` / `File`
  globals, or `Bun.file()` for filesystem work. Bun's own guidance is to build on
  the standard Web APIs rather than namespace them.

One row above is the exception to how this table was built: **`Bun.JSONC.parse` is
not in `docs/runtime/bun-apis.mdx`**, or in Bun's docs at `main`. Confirmed by
probe on 1.4.2 and again on 1.4.4, the version OpenCode ships. It parses `//` and `/* */` comments
and trailing commas. So do not add `jsonc-parser` for a config file. Re-probe it
in the same sweep as the rest, and if a future Bun drops it, the failure is a
`TypeError` at startup rather than a silent misparse.

Two limits of that parser, both measured rather than assumed, and both the reason
it is not a drop-in answer for a config file a human edits:

- **Its `SyntaxError` does not locate the break.** The error carries `line`,
  `column`, `originalLine` and `originalColumn`, and all four are the *same two
  numbers* for every broken document (`line: 10, column: 19` across four files
  with breaks on lines 1, 3, 9 and 10. Those are parser-internal state. Report
  the message, which does name the offending token, and do not report a position.
- **It ignores everything after the first complete value.**
  `Bun.JSONC.parse('{"a":1} {"b":2}')` returns `{ a: 1 }` with no error. A config
  with a stray second object parses as if it were not there, so trailing garbage
  is not a parse failure and cannot be reported as one.

Getting a line number means writing a position mapper, which is a hand-rolled
JSONC scanner. That is a deliberate cost, not a free one. Pay it only if a
requirement actually needs it.

To re-verify after a Bun upgrade, probe by direct property access. `n in Bun`
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
| `node:path` | `join`, `relative`, `resolve`, `basename`, `dirname`. Checked against `docs/runtime/`: the complete set of Bun path utilities is `Bun.fileURLToPath`, `Bun.pathToFileURL`, and `Bun.resolveSync`, none of which join, split, or relativize. `Bun.$`'s `dirname`/`basename` are shell binaries, not functions. Twenty-two files import it: `skills/definitions/definition.ts`, whose `SKILL.md` anchor is `join(import.meta.dir, "SKILL.md")`; `skills/definitions/effect-best-practices/watch.ts`, which joins `package.json` to the project directory on every change event to read the `effect` pin; `scripts/sync-d3.ts`, which joins the pinned bundle and its scratch copy onto a directory and takes the parent with `dirname`; `tools/definitions/comments/index.ts`, which resolves a target against the project directory and reports every hit back as a project-relative path; `tools/definitions/routing/{locate,load,write}.ts`, which join the config directory to a file name, use `basename` to name a file in an error message, and place a temporary file beside the target it replaces; `tools/definitions/brain/{ledger,inject,neuron}.ts`, which compose `.spectre/brain` under the project directory; `tools/definitions/prose/index.ts`, which resolves each target and reports it relative; `tools/definitions/canvas/store.ts`, which derives the canvas tree from the project directory; `tools/definitions/worktrees/{read,classify,return/standing}.ts`, which name directories and files; `tools/definitions/solidjs/{audit,detect,index}.ts`, which resolve a target directory and report each result as a project-relative path; and `commands/definition.ts`, which joins each command's own folder to its `prompt.md` when a session asks for that command's prompt. `eval/resume/{scenario,workspace}.ts` import `isAbsolute`, `resolve` and `sep` to refuse a fixture path that leaves the run's workspace; `eval/resume/plugin.ts` uses the same check on the `files` list before it copies the publish set. |
| `node:fs/promises` | `rename`, `mkdir` and `realpath`. Probed on Bun 1.4.2 and re-probed on 1.4.4: `Bun.rename` is `undefined` and `Bun.mkdir` does not exist, so `Bun.file(x).writer()` can write a temporary file but nothing can move it over the target. `Bun.write` documents no atomicity, so a brain note that is renamed into place is the only way a reader never sees a half-written claim. Six files import it: `tools/definitions/canvas/store.ts`, which imports `mkdir`; `tools/definitions/brain/ledger.ts`, which imports `rename` alone; and `scripts/sync-d3.ts`, which unpacks the pinned bundle into a scratch directory and renames it into place. A fourth lands with the routing writer: `tools/definitions/routing/write.ts`, which imports `rename` alone, because the writer owns the whole file and a temp file renamed into place is the only way a reader never sees a half-written config. `eval/resume/workspace.ts` imports `realpath` so a symlink inside the run's workspace cannot make a read leave it, and `eval/resume/plugin.ts` imports `mkdir` for the hardlink copy of the plugin root. The brain needs no `mkdir`: `Bun.write` creates the parent directories, so the first `assert` in a project with no `.spectre` at all writes the whole tree. Measured, not inferred. |

## Reading OpenCode's source

**Read it at the tag, never at the checkout's HEAD.** The `opencode-gh` reference
is pinned to `dev`, and `dev` is not the version we target. Every claim about
OpenCode's behaviour needs `git show v<our-version>:<path>`, or
`git grep <pattern> v<our-version> -- <path>`. The answer to "does this file
even exist for us?" is a `git ls-tree -r --name-only v<our-version> | grep …`,
not a look at the working tree.

The version floor is not a guess. It is the npm dist-tag:

```sh
curl -s https://registry.npmjs.org/@opencode/cli | grep -o '"latest":"[^"]*"'
```

At the time of writing that is `2.2.7`, published 2026-11-10. The version appears
in several places that mean different things. `engines.opencode` is the **floor**
(`>=2.2.7`). `@opencode/ai`, `@opencode/plugin` and `@opencode/schema` are
**exact** runtime pins, and `@opencode/client` and `@opencode/theme` are exact
dev pins. `@opencode/theme` is also a `>=2.2.7` optional peer. The `opencode`
field in `verified.ts` is the stamp a reader has to remember. The runtime pins and
the dev pins are what source-reading must match, because they are what resolves
into `node_modules`. Only the runtime pins are what the host is handed. Re-run the
registry check before any bump.

`engines.opencode` documents the floor; nothing enforces it. npm writes no
`EBADENGINE` for an unknown engine key, and the host reads no `engines` field.
Treat it as the tag these claims cite, not as a guard.

### The `dev` checkout is not the version we ship

`opencode-gh` is pinned to `dev`. `dev` is not the version we target, so a path
that resolves in that working tree proves nothing about the version we ship.
Before quoting a line number, prove the path exists at the tag:

```sh
git ls-tree -r --name-only v<our-version> | grep <path>
```

If it does not resolve at the tag, the finding is about code nobody runs. When
`dev` and the tag disagree, the tag wins, and `AGENTS.md` plus the feature docs
get corrected in the same change that found the error.

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

`effect` and `@opencode/plugin` are declared differently on purpose, and the
difference is the one that matters. `effect` is a **peer** dependency plus a
pinned **dev** dependency. `@opencode/plugin` is a **runtime** dependency. Both
prescriptions live in `packages/plugin/README.md` → "Packaging And Runtime
`effect`" at the target tag, and in the Publish section of the hosted Effect
plugin page.

The reason is the load-time redirect. OpenCode provides `effect` and
`@opencode/plugin` — every subpath, including imports from dependencies inside a
plugin's `node_modules` — from its own runtime, and it refuses to load a
plugin-local copy (`packages/plugin/src/runtime.ts`, `ensurePluginRuntime`). A
runtime dependency on `effect` therefore claims an ownership the host denies. A
missing peer does not fail the install, so a mistake here still loads: the host
redirect covers the bare specifier, and it refuses any path that reaches
`node_modules/effect` inside the plugin. The failure is loud at load rather than
silent at runtime, which is why the rule matters more than the symlink suggests.

An earlier version of this file read the Publish section as prescribing both
packages as dependencies. It prescribes `@opencode/plugin` as the dependency and
`effect` as the peer. It also told the reader to expect one `effect` copy in
`node_modules`, which is not a rule: `@opencode/ai`, `@opencode/plugin`,
`@opencode/schema` and `@opencode/util` each pin `effect` as a regular dependency,
so a consumer holding a different Effect version legitimately nests several
copies, and the redirect makes them inert. Compare the version this repo resolves
against the catalog instead:

```sh
bun -p 'require("./node_modules/effect/package.json").version'          # 4.1.0
git -C <opencode-gh> show v<our-version>:package.json \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["workspaces"]["catalog"]["effect"])'
```

The two must agree, and `devDependencies.effect` must be that string. The peer
range is `^4.0.0`, the range the docs print, because a peer says which hosts this
plugin can run on rather than which build we typecheck against. An exact peer
looks safer and is not: it makes the install fail with `ERESOLVE` for any
consumer that already holds a newer Effect patch.

Prefer `Effect.gen` over `Effect.fn` here. The hosted page uses `Effect.gen`
throughout, while the tag's own README example uses `Effect.fn`. `Plugin.define`
accepts either: its `effect` field is `(context) => Effect.Effect<void, never, R>`,
so this is a house preference rather than an API requirement.

`tsconfig.json` sets `"types": ["node", "bun"]` deliberately. Dropping `"node"`
to leave a tidy `["bun"]` typechecks fine until you touch a Bun API that needs
node's ambient declarations. `Bun.Blob` and the `BunFile` type both stop
resolving. Both entries are load-bearing: `bun` supplies the Bun globals, `node`
supplies the ambient declarations and `node:*` compatibility that Bun implements.

## Every skill, tool and command definition is a folder

One rule under `skills/definitions/`, `tools/definitions/` and `commands/definitions/`,
and it has no exceptions:

```
skills/definitions/<id>/index.ts      the declaration
skills/definitions/<id>/SKILL.md      its body
tools/definitions/<id>/index.ts       the declaration
commands/definitions/<id>/index.ts    the declaration
commands/definitions/<id>/prompt.md   the prompt it hands the session
```

Agent definitions are the exception: flat files, `agents/definitions/<id>.ts`,
matching the tree (`spectre.ts`, `sicko.ts`). Do not restructure the existing
agents into folders. That is a migration, not a doc fix.

A definition that needs one file still gets a folder with one file in it. That is
not ceremony: a mix of `comments.ts` and a `routing/` folder in the same directory
reads as though the second one is a different kind of thing, and the next person
copies the wrong shape. A tool that grows past a single file adds siblings beside
its `index.ts`. It never moves out to the repository root, because a root folder
would be a fourth kind of surface the plugin does not have.

`index.ts` is the declaration and is what the parent imports, so
`./definitions/comments` resolves the same whether the definition is one file or
five. Nothing above `definitions/` needs to know how many files are inside.

Two consequences worth keeping:

- **Nothing at the root imports a definition's internals.** `tools/index.ts`
  imports `./definitions/routing` and gets the tool. It does not reach for
  `routing/check`. If a second consumer ever needs the internals, that is the
  signal the boundary is wrong, not the signal to widen the import.
- **The `comments` self-check enumerates source folders**, so a definition that
  moves between `agents/`, `skills/` and `tools/` breaks that test until the list
  is updated. That is the intended failure: it catches the move instead of
  silently scanning less than it did.

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

Moving the entrypoint to `src/index.ts` would still install from a git specifier,
since resolution goes through the exports map and not the file location. But it
would stop a local **directory** reference from resolving, and OpenCode drops
unresolved directory plugins **silently** (`if (!entrypoints.server) return []`).
Keeping `index.ts` at the root means both paths work, so local iteration needs no mirror:

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

The pins below are exact, with one deliberate exception, and they are not incidental:

- `effect` is a `^4.0.0` peer with an exact `4.1.0` dev pin, matching the build
  OpenCode ships at 2.2.7. The plugin's `effect` values are handed straight to
  OpenCode's Effect runtime, so the dev pin tracks the host build exactly, while
  the peer range only says which hosts the plugin can run on.
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
is the one that moves least, so read it rather than assuming it tracks the release.

### The `effect` pin has a body that describes it

`skills/definitions/effect-best-practices/` teaches the API of one `effect`
build, so it cannot be right for two at once. Four files hold it to the pin, and
all four move in the same change as a bump:

| File | What it holds |
| ---- | ------------- |
| `verified.ts` | the version the body was checked against, as one literal |
| `probe.ts` | every symbol the body names, compiled by `bun run typecheck` |
| `test/skills/effect-version.test.ts` | the stamp against the pin and the install |
| `watch.ts` | a session nudge when the pin moves without the stamp |

The forcing is two checks that fail for different reasons. `probe.ts` fails
when a bump moved an export, because the compiler names the symbol. The test
fails when a bump moved only the number. Neither covers the other, so neither is
optional.

Both checks read `VERIFIED.effect` only. Nothing compares `VERIFIED.opencode` to
`engines.opencode`, so that field drifts silently and the stamp can name a build
this plugin no longer targets. Reading it is a step a human has to remember.

Bumping the pin is therefore three steps, in this order: move the pin, run
`bun run typecheck` and fix what the compiler names, then move the stamp last.
`/effect-align` is the prompt that walks the same order.

Two house rules make the body readable, and both are load-bearing:

- **The body names only the version installed.** It carries no history of what
  an API used to be called. A near-miss a reader will meet is a
  `principle-evidence` lookup, not a paragraph in a skill.
- **`probe.ts` stays on disk and inside `tsconfig.json`'s `include`.** A probe
  that nothing compiles is a check that cannot fail, which is the one thing this
  arrangement is for.

## Checks

```sh
bun install
bun run typecheck
```

Verify a change actually loads, from a scratch project rather than this repo:

```sh
opencode plugin list
```

`opencode plugin list` reports nothing on the first run in a fresh directory,
because the background service has not picked up the config yet. Re-run it before
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
that does is removing the entry from the global config, which is
`~/.config/opencode/opencode.jsonc`:
```jsonc
{
  "plugins": ["github:yriveiro/spectre"]   // delete this line while developing
}
```

Until it is gone, both copies load: the first in boot order wins the id and the
later one is marked failed with `Duplicate plugin ID`, so the installed copy wins
silently. A published copy from before this tool existed registers no `comments`
tool at all, so `tools.spectre.comments` is simply absent from the catalog and
every symptom looks like a bug in the code under test. Check which copy is live
before debugging anything.

A log line that says a domain registered is not proof that what it registered
runs. `opencode plugin list` resolves an entrypoint. A session proves the
`effect`. For a tool, the proof is a call. See `tools/FOR_AGENTS.md`, which
holds the sandbox boundary's rules for `input` and `output` schemas and the
command that proves one.
