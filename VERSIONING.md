# Versioning and Live Verification

On-demand runbook for bumping OpenCode or `effect` pins, verifying package dependencies, and testing a local checkout in OpenCode.

## Reading OpenCode source at the target tag

The `opencode-gh` reference tracks `dev`, which is not the version Spectre ships against. Check every path and line at the target tag:

```sh
git ls-tree -r --name-only v<version> | grep <path>
git show v<version>:<path>
git grep <pattern> v<version> -- <path>
```

Find the latest published OpenCode CLI version from npm before a bump:

```sh
curl -s https://registry.npmjs.org/@opencode/cli | grep -o '"latest":"[^"]*"'
```

## Version pins in `package.json`

- `engines.opencode` documents the minimum floor (`>=2.4.2`). Neither npm nor OpenCode enforces it.
- `@opencode/ai`, `@opencode/plugin`, and `@opencode/schema` are exact runtime pins. `@opencode/schema` matches `@opencode/plugin` so branded types such as `AbsolutePath` never split across two copies.
- `@opencode/client`, `@opencode/codemode`, and `@opencode/theme` are exact dev pins. `@opencode/theme` is also an optional peer (`>=2.4.2`).
- `effect` is a `^4.0.0` peer dependency plus an exact dev pin (`4.1.0`) matching OpenCode's catalog at the target tag. OpenCode redirects `effect` and `@opencode/plugin` to its own runtime and refuses a plugin-local copy (`packages/plugin/src/runtime.ts`, `ensurePluginRuntime`).
- `d3` uses a `^7.9.2` caret because it is a bundled page asset rather than a host contract. Run `bun run d3.check` to check for updates.

Compare the installed `effect` build against OpenCode's workspace catalog at the target tag:

```sh
bun -p 'require("./node_modules/effect/package.json").version'
git -C <opencode-gh> show v<version>:package.json \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["workspaces"]["catalog"]["effect"])'
```

After moving an OpenCode version pin, confirm no old version string remains:

```sh
grep -rn '<old-version>' --include='*.json' --include='*.md' --include='*.ts' . \
  | grep -v node_modules
```

## Aligning `effect-best-practices`

Four files hold `skills/definitions/effect-best-practices/` to the pinned `effect` build:

| File | Role |
| ---- | ---- |
| `skills/definitions/effect-best-practices/verified.ts` | Records the verified `opencode` and `effect` versions |
| `skills/definitions/effect-best-practices/probe.ts` | Compiles every Effect symbol named in the skill body |
| `test/skills/effect-version.test.ts` | Checks `VERIFIED.effect` against `package.json` and `node_modules` |
| `skills/definitions/effect-best-practices/watch.ts` | Nudges a session when the pin moves ahead of the stamp |

Run `/effect-align` after an `effect` bump. Keep `probe.ts` in `tsconfig.json`'s `include` and update `VERIFIED.opencode` by hand because the test checks `VERIFIED.effect` only.

## Bun runtime notes

Probe Bun globals by direct property access after a Bun upgrade (`n in Bun` returns `false` for lazily defined members):

```sh
bun -e 'for (const n of ["path","Blob","Glob","sleep"]) console.log(n, typeof Bun[n])'
```

`Bun.path`, `Bun.Blob`, and `Bun.File` do not exist. Use `node:path` for path manipulation and standard Web `Blob` / `File` globals.

`Bun.JSONC.parse` parses comments and trailing commas on Bun `1.4.4`, with two measured limits:

- Its `SyntaxError` reports fixed internal line and column numbers instead of the break location. Report `error.message` without a position.
- It ignores trailing tokens after the first complete JSON value (`Bun.JSONC.parse('{"a":1} {"b":2}')` returns `{ a: 1 }`).

## Verifying a local checkout in OpenCode

1. Remove `"github:yriveiro/spectre"` from `~/.config/opencode/opencode.jsonc`. Setting `OPENCODE_CONFIG_DIR` alone does not unseat the cached install, and the first plugin in boot order wins on duplicate ID.
2. Add the absolute checkout directory to a scratch project's `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/absolute/path/to/spectre"]
}
```

3. Run `opencode plugin list` twice in that scratch project (the first run in a fresh directory can return empty before the background service picks up config).
4. Prove the plugin `effect` runs by checking startup logs:

```sh
OPENCODE_CONFIG_DIR=/tmp/empty-cfg opencode run --standalone --log-level info --print-logs \
  'reply with the single word: ok'
```

5. For tool changes, prove the tool runs inside Code Mode using the steps in `tools/FOR_AGENTS.md`.
