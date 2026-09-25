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

## Agents

Spectre declares its agents the way OpenCode declares its own built-ins: a typed
value in TypeScript, applied through `ctx.agent.transform`, with the prompt
inline.

```ts title="agents/spectre.ts"
import { Agent } from "@opencode/plugin/effect"

export const spectre: Partial<Agent.Info> & Pick<Agent.Info, "id"> = {
  id: Agent.ID.make("spectre"),
  description: "Spectre's coding agent.",
  mode: "primary",
  color: "primary",
  system: `You are Spectre, a coding agent.
`,
}
```

The annotation checks every field against `Agent.Info` at compile time and
rejects a key it does not have, so a typo or a bad enum is a build error rather
than a silently half-configured agent:

```
agents/spectre.ts(17,3): error TS2561: Object literal may only specify known
properties, but 'colour' does not exist in type 'Partial<Info> & Pick<Info, "id">'.
Did you mean to write 'color'?
```

Omitted fields keep the value `Agent.Info.default(id)` already supplies, so a
definition only states what it changes. `permissions` **extend** the agent's
seeded rules rather than replacing them — the same layering OpenCode's own agent
plugins use — so a project's global rules still land on top and the last matching
rule wins. Leaving `permissions` off gives the agent OpenCode's standard coding
rules: allow tools, ask on `.env` reads and outside the worktree.

### How an agent gets registered

The editor behind `ctx.agent.transform` has no `add`. Its `update` creates an
agent that does not exist yet, which is how a plugin introduces one, and how
OpenCode's own `build`, `plan`, and `explore` are declared. Registering does not
make an agent the default; the user's `default_agent` is left alone.

A file-based alternative exists — OpenCode reads `agent/` and `agents/` folders
of markdown with YAML frontmatter — but only inside a _config_ directory, the
global `~/.config/opencode` or a project's `.opencode`, never inside an installed
plugin. A folder shipped in this package would go unread, which is one reason
Spectre declares agents in TypeScript.

## Layout

| Path                | Purpose                                                      |
| ------------------- | ------------------------------------------------------------ |
| `index.ts`          | Plugin entrypoint: `id` plus the `effect` that runs.         |
| `agents/spectre.ts` | One agent: its id, description, mode, and prompt.            |
| `agents/index.ts`   | Applies every definition to OpenCode's agent registry.       |

## Development

```sh
bun install
bun run typecheck
```

