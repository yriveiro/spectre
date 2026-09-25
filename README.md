# Spectre

Spectre is a coding agent built on top of OpenCode, delivered as an OpenCode plugin.

## Requirements

- OpenCode `>= 2.0.16`

## Install

```sh
opencode plugin add github:yriveiro/spectre
```

This installs the package from GitHub and registers it in your global OpenCode
configuration (`~/.config/opencode/opencode.jsonc`). Verify, and undo, with:

```sh
opencode plugin list
opencode plugin remove github:yriveiro/spectre
```

To register it for a single repository instead, add the spec under `plugins` in
that project's configuration:

```json title="opencode.json"
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["github:yriveiro/spectre"]
}
```

`plugin` is still accepted as a legacy alias for `plugins`.

While developing, install from a local mirror of the checkout — this exercises the
same path as the GitHub install:

```sh
git clone --bare /absolute/path/to/spectre /tmp/spectre-mirror.git
opencode plugin add "git+file:///tmp/spectre-mirror.git"
```

While developing, point OpenCode at the checkout directly — no install step, no
build:

```json title="opencode.json"
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/absolute/path/to/spectre"]
}
```

## How it plugs in

OpenCode resolves `index.ts` through the package's `.` export and calls the
plugin's `effect` once per project instance. Everything Spectre contributes —
skills, agents, tools, nested plugins, MCP servers — is registered from inside that
`effect`, through the domains on `ctx`.

The entrypoint follows the official
[Effect plugin docs](https://opencode.ai/v2/docs/build/plugins/effect/):

```ts title="index.ts"
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

`@opencode/plugin` and `effect` are both runtime dependencies, as the docs
prescribe. `effect` is pinned to the exact build OpenCode ships, which also keeps
the two resolving to a single deduped copy.

TypeScript is shipped as-is — there is no `dist` and no build step, because a git
install does not run one. Keeping `index.ts` in the repository root lets the same
file satisfy both a git-spec install and a local directory reference.

## Layout

| Path       | Purpose                                             |
| ---------- | --------------------------------------------------- |
| `index.ts` | Plugin entrypoint: `id` plus the `effect` that runs. |
| `src/`     | Implementation, imported by the entrypoint.          |

## Development

```sh
bun install
bun run typecheck
```

