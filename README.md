# Spectre

Software Planning, Engineering, Coding, Testing, Reasoning & Execution, delivered
as an OpenCode plugin.

## Requirements

- OpenCode `>= 2.0.21`

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

While developing, install from a local mirror of the checkout. This exercises the
same path as the GitHub install:

```sh
git clone --bare /absolute/path/to/spectre /tmp/spectre-mirror.git
opencode plugin add "git+file:///tmp/spectre-mirror.git"
```

While developing, point OpenCode at the checkout directly. No install step, no
build:

```json title="opencode.json"
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/absolute/path/to/spectre"]
}
```

## How it plugs in

OpenCode resolves `index.ts` through the package's `.` export and calls the
plugin's `effect` once per project instance. Everything Spectre contributes
(skills, agents, tools, nested plugins, MCP servers) is registered from inside that
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

TypeScript is shipped as-is. There is no `dist` and no build step, because a git
install does not run one. Keeping `index.ts` in the repository root lets the same
file satisfy both a git-spec install and a local directory reference.

## Agents

Spectre declares its agents the way OpenCode declares its own built-ins: a typed
value in TypeScript, applied through `ctx.agent.transform`, with the prompt
inline.

```ts title="agents/definitions/spectre.ts"
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

```text
agents/definitions/spectre.ts(17,3): error TS2561: Object literal may only specify known
properties, but 'colour' does not exist in type 'Partial<Info> & Pick<Info, "id">'.
Did you mean to write 'color'?
```

Omitted fields keep the value `Agent.Info.default(id)` already supplies, so a
definition only states what it changes. `permissions` **extend** the agent's
seeded rules rather than replacing them. It is the same layering OpenCode's own agent
plugins use, so a project's global rules still land on top and the last matching
rule wins. Leaving `permissions` off gives the agent OpenCode's standard coding
rules: allow tools, ask on `.env` reads and outside the worktree.

### How an agent gets registered

The editor behind `ctx.agent.transform` has no `add`. Its `update` creates an
agent that does not exist yet, which is how a plugin introduces one, and how
OpenCode's own `build`, `plan`, and `explore` are declared. Registering does not
make an agent the default; the user's `default_agent` is left alone.

A file-based alternative exists. OpenCode reads `agent/` and `agents/` folders
of markdown with YAML frontmatter, but only inside a _config_ directory, the
global `~/.config/opencode` or a project's `.opencode`, never inside an installed
plugin. A folder shipped in this package would go unread, which is one reason
Spectre declares agents in TypeScript.

## Layout

| Path                               | Purpose                                                       |
| ---------------------------------- | ------------------------------------------------------------- |
| `index.ts`                         | Plugin entrypoint: `id` plus the `effect` that runs.          |
| `agents/definitions/spectre.ts`    | One agent: its id, description, mode, and prompt.             |
| `agents/index.ts`                  | Applies every definition to OpenCode's agent registry.        |
| `skills/definitions/<id>/`         | One skill per directory: `index.ts`, `SKILL.md`.              |
| `skills/definitions/index.ts`      | The skill list, checked against what is on disk, plus bodies. |
| `skills/definitions/definition.ts` | What every `index.ts` declares, and the `SKILL.md` anchor.    |
| `skills/index.ts`                  | Applies every definition to OpenCode's skill registry.        |
| `tools/definitions/comments.ts`    | One tool: the comment and suppression inventory.              |
| `tools/index.ts`                   | Applies every definition to OpenCode's tool registry.         |
| `tools/FOR_AGENTS.md`              | Read by hand before touching a tool schema. Not auto-loaded.  |

## Tools

A tool is a typed `Tool.Info` applied through `ctx.tool.transform`. Spectre ships
one, `spectre.comments`, and it exists to be called from inside a Code Mode
script rather than as a direct tool call:

```ts title="tools/definitions/comments.ts"
import { Effect, Schema } from "effect";
import { Tool } from "@opencode/schema/tool";

export const comments = (directory: AbsolutePath): Tool.Info<typeof Input, typeof Output> => ({
  name: "comments",
  description: DESCRIPTION,
  input: Input,
  output: Output,
  options: { namespace: "spectre", codemode: true, pinned: true, permission: "read" },
  execute: (input) => Effect.promise(async () => ({ output: await inventory(directory, input) })),
});
```

Three of those `options` are load-bearing, and OpenCode's own type says so.
`Tool.Options` is a union in which omitting `codemode` means `true`:

```ts
export type Options = BaseOptions & (
  | { readonly codemode?: true; readonly pinned?: boolean }
  | { readonly codemode: boolean; readonly pinned?: never }
)
```

- **`codemode: true`** puts the tool in the Code Mode catalog and keeps it out of
  the model's direct tool list. It is reachable only as
  `tools.spectre.comments(...)` from inside `execute`, which is the point: the
  inventory is a few hundred structured hits, and a script can filter them down
  to the handful worth reading before any of it reaches the context. Set
  `codemode: false` instead and the same tool becomes an ordinary call whose
  whole output lands in the transcript.
- **`pinned: true`** hoists the signature to the top of the catalog. The catalog
  is budgeted and partial, so an unpinned tool can be reachable only through
  `tools.$codemode.search`.
- **`namespace: "spectre"`** is what makes the path `spectre.comments` rather
  than a bare top-level `comments`.

`execute` returns a structured `output`, not a rendered report, and the schema is
the contract: OpenCode validates the value against it before the sandbox sees
it. Declare **plain** schemas only and do any checking inside `execute`. The
boundary rejects `Int`, `Finite`, `NonEmptyString`, `URL`, and anything built
with `Schema.check` or `Schema.refine`, and on two of those it fails with its
own internal error instead of naming the field.
[`tools/FOR_AGENTS.md`](tools/FOR_AGENTS.md) has the measured table, the rule,
and the command that proves a tool actually runs.

## `execute` is on in Spectre Mode

The `spectre` agent allows the `execute` action outright:

```ts title="agents/definitions/spectre.ts"
permissions: [{ action: "execute", resource: "*", effect: "allow" }],
```

A tool registered with `codemode: true` is invisible to the model without it, so
a skill that depends on one has to be able to assume it. This is a floor, not an
override: session and project permission rules merge over an agent's own and the
last match wins, so a user who denies `execute` still wins. `code-hygiene` is the
skill that tests the assumption. Step 1 checks for `execute` and stops with a
message rather than falling back to `grep`.

## Development

```sh
bun install
bun run typecheck
```
