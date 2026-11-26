# AGENTS.md

Working notes for anyone (human or agent) changing this repository.

## What this repo is

Spectre is an OpenCode plugin. `index.ts` at the repository root default-exports `Plugin.define({ id, effect })`, and OpenCode calls `effect` once per project instance to register skills, agents, tools, and commands.

Minimum supported OpenCode version is **2.4.2** (`engines.opencode` in `package.json`). Ship TypeScript source as-is. Do not add a build step, a bundler, a `prepare` script, or a `dist/` directory.

## Runtime: Bun first

OpenCode ships as a Bun standalone executable (`1.4.4` at `2.4.2`). Use Bun APIs (`Bun.file`, `Bun.write`, `Bun.Glob`, `Bun.spawn`, `Bun.$`, `Bun.JSONC.parse`, `bun:test`) before `node:*` modules or npm packages.

`test/runtime-exceptions.test.ts` approves only two `node:*` imports in source code:

- `node:path` for `join`, `relative`, `resolve`, `basename`, `dirname`, `isAbsolute`, and `sep`.
- `node:fs/promises` for `rename`, `mkdir`, `realpath`, and `rm`.

## OpenCode contract

- Load the `opencode-platform` skill before changing `ctx.*` calls, hooks, or tool definitions.
- Read OpenCode source at the target tag (`git show v<version>:<path>`), never at `opencode-gh`'s `dev` HEAD.
- Keep `index.ts` at the repository root and `"exports": { ".": "./index.ts", "./tui": "./tui/index.tsx" }` in `package.json` so both `github:` specs and local directory configs resolve.
- Keep `"types": ["node", "bun"]` in `tsconfig.json`. Dropping `"node"` breaks ambient types used by Bun APIs.
- Import host singletons from `@opencode/plugin/effect`, not `@opencode/schema/*`. This covers `Tool`, `Agent`, `Artifact`, `Command`, `Model`, `Provider`, `Skill`, `Vcs`, and `Worktree`.
- Prefer `Effect.gen` over `Effect.fn` in the plugin entrypoint.

## Layout invariants

Every skill, tool, and command definition lives in its own folder under `skills/definitions/<id>/`, `tools/definitions/<id>/`, or `commands/definitions/<id>/`, even when it has one file:

```text
skills/definitions/<id>/index.ts      declaration
skills/definitions/<id>/SKILL.md      body
tools/definitions/<id>/index.ts       declaration
commands/definitions/<id>/index.ts    declaration
commands/definitions/<id>/prompt.md   prompt
```

- Agent definitions stay flat files under `agents/definitions/<id>.ts`.
- Nothing outside a definition folder imports its internal files. Add siblings beside `index.ts` when a definition grows.
- Each TUI feature lives in its own folder under `tui/<feature>/` and registers through `register<Feature>(context)` from `tui/index.tsx`. Shared render helpers stay in `tui/render.ts`, `tui/blade.tsx`, and `tui/blade-layout.ts`.
- Moving definitions across top-level folders requires updating the `comments` self-check source list.

## On-demand docs

- `VERSIONING.md` — OpenCode and `effect` version pins, `peerDependencies` rules, `Bun.JSONC.parse` limits, and live plugin verification.
- `tools/FOR_AGENTS.md` — Code Mode tool schema rules and verification commands.
- `skills/FOR_AGENTS.md` — skill authoring rules and eval budgets.
- `/effect-align` — procedure for aligning `effect-best-practices` after an `effect` bump.

## Checks

```sh
bun install
bun run typecheck
GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=commit.gpgsign GIT_CONFIG_VALUE_0=false bun test
```

The `GIT_CONFIG_*` override prevents hardware GPG prompts in git-committing tests. When testing a local checkout live in OpenCode, remove `"github:yriveiro/spectre"` from `~/.config/opencode/opencode.jsonc` first or the cached copy wins on duplicate plugin ID. See `VERSIONING.md` for live verification commands.
