# AGENTS.md

Working rules for the Spectre v2 worktree (`next`). `docs/philosophy.md` is the
design record: read it before a change that moves a boundary. Paths without a
prefix are in this worktree, and `main/` names the v1 worktree.

## What this repo is

`spectre` is one package and one install unit: one server plugin, `yriveiro.spectre`,
and one TUI plugin. Blocks are internal, and no block gets its own plugin id.
`index.ts` composes the bundle, and `packages/core` is a private library that supplies
the contract and the harness. The bundle composes the routing block today;
each later slice adds one.

## Blocks and bundles

A block is one capability, and a bundle is the install unit: one package, one plugin
id, several blocks. A block carries an `id`, a `surfaces` declaration, and an `effect`
that receives the real `Plugin.Context` (`packages/core/block.ts`). The end state has 14 blocks.

- Only `index.ts` imports more than one block. It is the composition root.
- A block imports its own folder and `blocks/shared/`, never a sibling block.
- A cross-block value is a factory argument at the root: `routing({ agents })`,
  `prose(dictionarySource)`. Add no field, service, or shared constant.
- Config belongs to the capability that reads it. Routing owns `spectre.json`,
  and `packages/core` owns no feature config.
- A leaf two blocks need goes in `blocks/shared/`. With one consumer, it stays in that block.

`defineBundle` rejects a duplicate block id, a duplicate surface in one block, and two
blocks that declare the same tool, skill, command, or agent. The ownership check skips hooks.

## The SDK seam

A block registers through `ctx.tool.transform`, `ctx.skill.transform`, `ctx.command.transform`,
`ctx.agent.transform`, and `ctx.tool.hook`, and through nothing else. There is no Spectre
registration API, no service container, and no collector. Pass a cross-block value at the root.

Transforms are lazy. The host stores the callback and replays it on the first read
of that registry, after the plugin effect returns. A block cannot observe what it
registered, and the bundle cannot validate against it.

`Surfaces` is test-time, not a registration path (`packages/core/block.ts`). It names
effective tool names (`spectre_routing`), skill and command names, agent ids, and the two
tool hook names. Session hooks and event subscriptions are open sets and stay out of `Surfaces`.
`surfaceProblems` compares the declaration against `testContext`, so a block can drift.

`runBlock`, `testContext`, and `surfaceProblems` are the harness (`packages/core/harness.ts`,
`packages/core/surface.ts`). It supports `tool`, `skill`, `command`, `agent`, and `tool.hook`.
Any other `ctx` domain throws. Slice 0 adds `location`, `session.hook`, and
`event.subscribe`, which worktrees, brain, and effect need before their tests run.

## Failure policy

Each block runs in a child scope forked from the plugin's activation scope
(`packages/core/bundle.ts`). A typed block failure is local: the bundle closes
that scope, discards the block's registrations, logs the failure, and runs the
next block. A defect or an interrupt is fatal: the bundle rethrows it, and the
plugin effect fails.

Return a typed failure when the capability cannot start. Do not catch a defect,
and do not treat an interrupt as a soft failure. A test holds both halves
(`packages/core/test/core.test.ts`).

The host reports one plugin, not one row per block. A failed block is an
`Effect.logError` line, not host status, so do not add a plugin per block.

## TUI

The server `Plugin.Context` has no TUI domain. The package exposes a separate
`./tui` entrypoint, and `tui/index.tsx` composes every TUI part into one
`Plugin.define` with one cleanup chain. Slice 4 adds the export.

A block with a TUI part keeps it in `blocks/<name>/tui/`. The server block never
imports it, and the TUI part never imports the server tool module. Routing's
`tui/data.ts` imports `../config/`, not `../tool.ts`, so the TUI graph does not
load `@opencode/plugin/effect`.

## Packaging

The repository root is the package, and its `index.ts` is the `.` export. A local
directory reference resolves `<dir>/index.ts`, and a `github:` spec resolves
through `exports["."]`, so both work with no mirror.

- No build step. Ship TypeScript as-is. Add no `dist`, bundler, or `prepare` script.
- `packages/core` stays private and ships inside the root package through
  `files`. Update `files` in the same commit that adds a runtime-read file.
- The final slice adds the pack test. It lists every runtime-read file, including
  `.md`, `.json`, and `.ts` (`npm pack --dry-run --json`), installs the tarball
  in a temp directory, loads the bundle, and runs every block in `testContext`.

## Platform

Spectre targets OpenCode **2.2.6**. The installed SDK is the runtime. The exact
pins are `@opencode/plugin` 2.2.6, `@opencode/schema` 2.2.6, and `effect` 4.1.0,
and `engines.opencode` states the floor (`>=2.2.6`).

Read OpenCode source at the tag, never at `dev`: `git show v2.2.6:<path>` or `git grep
<pattern> v2.2.6 -- <path>`. A path that resolves in the `dev` checkout proves nothing
about this plugin. `main/AGENTS.md` holds the full rule.

## Runtime: Bun first

The plugin runs on the Bun build that OpenCode ships. Reach for a Bun API first, and add
no dependency for anything Bun does natively. This project approves two `node:*` imports:

| Import | Why |
| --- | --- |
| `node:path` | Bun has no `join`, `relative`, `extname`, `basename`, or `dirname`. |
| `node:fs/promises` | `rename` and `mkdir` have no Bun equivalent. |

The replacement table and the probes behind these rows are in `main/AGENTS.md`.
Any other `node:*` import is a slip.

## Checks

```sh
bun run typecheck
bun test
```

`bun run typecheck` is `tsc6 --noEmit` over `index.ts`, `packages/**/*.ts`,
`blocks/**/*.ts`, `blocks/**/*.tsx`, and `tui/**/*.tsx`. `bun test`
runs `packages/core` and every block suite. A slice also runs the bundle test once slice 0 lands.

Prove the entrypoint resolves from a scratch project:

```sh
opencode plugin list
```

A fresh directory can report nothing before the background service reads the
config, so re-run it. To prove the `effect` ran, start a session with logs:

```sh
OPENCODE_CONFIG_DIR=/tmp/empty-cfg opencode run --standalone --log-level info --print-logs \
  'reply with the single word: ok'
```

`OPENCODE_CONFIG_DIR` does not unseat a global install. A `github:` copy in
`~/.config/opencode/opencode.jsonc` can win boot order, and the local copy fails
with `Duplicate plugin ID`. Remove that line before debugging a missing tool.

## Worktrees

Never create a branch in the checkout you stand in. Isolate the work:

```js
await tools.spectre.worktrees({ action: "start", name: "v2-routing" })
```

Only `status: "opened"` means the worktree exists. A second unit of work is a
second worktree, including inside `next`. Do not switch branches here or edit another worktree.

## Migration

The migration brief defines the slice order. Four rules hold every slice:

1. The tree loads and typechecks after the slice: `bun run typecheck` and the bundle test.
2. Tests move with their subject. `blocks/<name>/test/` holds the block's suite.
   Cross-cutting tests stay at the top level.
3. Delete an aggregator, never port it. `tools/index.ts`, `skills/index.ts`,
   `agents/index.ts`, and `commands/index.ts` do not exist in the end state.
4. Only `index.ts` imports more than one block, and the final slice adds that test.

The final slice also pins the pack list and runs a temp install. Do not leave a
half-moved capability across two slices.

## Comments

Default to none. Fresh code carries its own meaning, so fix the code rather than
describe it. Keep a comment only for a legal or license header, behavior forced
from outside this repo, a `// prettier-ignore`, a public API contract, or a link
to the issue behind a constraint.

## Commits

Use conventional commits: `type(scope): subject`, one commit per migration slice.
The scope names the block or `core`, as in `feat(routing): add the routing block`.
