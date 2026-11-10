# Philosophy

Spectre v2 is an OpenCode plugin made of blocks. This document states the
decisions a maintainer should not have to rediscover. Paths are in this worktree.
A path that starts with `main/` names the v1 worktree.

## OpenCode 2.2.6 is the platform

Spectre targets OpenCode 2.2.6. The installed CLI is the only runtime, and the
package ships TypeScript with no build step (`README.md`, `AGENTS.md`).
`engines.opencode` states the floor, and the plugin and schema packages pin
2.2.6 exactly (`package.json`, `packages/core/package.json`).

The plugin SDK is the seam. A block receives the real `Plugin.Context` and
registers through the host's own editors: `ctx.tool.transform`,
`ctx.skill.transform`, `ctx.command.transform`, `ctx.agent.transform`, and
`ctx.tool.hook` (`packages/core/block.ts`). The host owns the plugin scope, and
a block runs inside a child of it (`packages/core/bundle.ts`). Spectre adds no
registration API beside the SDK's.

The seam decides what Spectre does not build. OpenCode parses a model reference,
lists the catalogue, validates a tool schema, and resolves permissions. Spectre
uses those answers and adds the policy the host has no opinion about
(`main/features/model-routing.md`).

## A block is one capability

A block is a named capability with its own effect. It carries an `id`, a
`surfaces` declaration, and an `effect` that receives `Plugin.Context`
(`packages/core/block.ts`). The effect has the same shape as `Plugin.effect`, so
a block registers exactly as a plugin does, one level lower.

A capability is a thing a maintainer can name, test, and own, not a file, a
phase, or a layer. A block may register a tool, a skill, a command, an agent,
and a hook. Routing is one block because routing is one capability, even though
it crosses several surfaces.

`Surfaces` is a test-time declaration, not a registration path
(`packages/core/block.ts`). The bundle cannot read it at registration time,
because the host applies transform callbacks later. The test harness compares
the declaration against what the block registered and reports the difference
(`packages/core/surface.ts`, `packages/core/harness.ts`).

## A bundle is the install unit

A bundle is one package, one plugin id, and several blocks
(`packages/core/bundle.ts`, migration brief). `defineBundle` returns a
`Plugin.define` value, so the host installs and calls it like any other plugin
(`packages/core/bundle.ts`, `index.ts`).

Blocks are internal. They are not plugins, and the host never sees them. The
package exposes one plugin id, `yriveiro.spectre`, and the bundle's effect walks
its blocks inside that one plugin (`index.ts`, `packages/core/bundle.ts`). The
bundle checks its list first: a duplicate block id is an error, and two blocks
that declare the same tool, skill, command, or agent are an error, because one
surface has one owner (`packages/core/bundle.ts`,
`packages/core/test/core.test.ts`).

## The host applies transforms lazily, and failure stays local

The host applies transform callbacks after the plugin effect returns. A block
therefore cannot observe the registered surfaces during its own run, and the
bundle cannot validate against them (`packages/core/block.ts`). Tests check
surfaces, not the session.

The bundle runs each block in a child scope forked from the plugin's activation
scope (`packages/core/bundle.ts`). A typed block failure closes that scope and
discards the block's registrations. The bundle logs the failure and continues
with the next block. A defect or an interrupt is different: the bundle rethrows
it and the plugin effect fails (`packages/core/bundle.ts`). A test holds both
halves (`packages/core/test/core.test.ts`).

That is the contract for a block author. Return a typed failure when the
capability cannot start. Do not catch a defect, and do not treat an interrupt as
a soft failure.

## Routing is one block

Routing is one block and the umbrella for everything routing-related: the
routing tool, its config schema and loader, `spectre.default.json`, the
`model-router` skill, the routing tests, and the routing TUI editor (migration
brief, `main/features/routing.md`).

It is not a separate plugin. A second install unit would give the host two
plugins for one capability. Routing belongs in the bundle with the rest.

The TUI has one seam of its own. The server `Plugin.Context` has no TUI domain,
so a block cannot register a TUI part through `ctx` (migration brief, hard seam
4). The package exposes a separate `./tui` entrypoint for the editor
(`main/features/routing.md`, "Phase B"). Routing owns the editor, and the package
entry composes it.

## The core is a library

The core composes blocks, defines the bundle configuration, states the contracts,
and supplies the test harness. `defineBundle` composes. `Block`, `Surfaces`, and
`HookName` are the contract. `runBlock`, `testContext`, and `surfaceProblems` are
the harness (`packages/core/index.ts`). `step` names one internal step as a trace
span (`packages/core/step.ts`).

The core owns no capability. It registers no tool, skill, command, agent, or
hook, and it reads no feature config. Its configuration is the bundle value: one
id and a list of blocks (`packages/core/bundle.ts`). Capability configuration
belongs to the block that reads it, so the routing block owns `spectre.json`.

The core is not a framework. It does not collect registrations, provide a
service container, or offer a second registration API. A block receives the
host's context, and the core only isolates and tests the block. The migration
brief names the failure this avoids: a shallow module, a pass-through layer, or
a second registration path.

## What v1 was, and what v2 changes

v1 registered everything from one effect. `main/index.ts` calls `agents.update`,
`skills.update`, `tools.update`, and `commands.update` in one `Plugin.define`
effect. `main/tools/index.ts` loads the routing config once for `prose`, builds
eleven tools, registers a hook, and calls `sessionReturn` and `attach`.

Ownership crossed module boundaries. The aggregator loaded the routing config
once to pass `tables.dictionary.path` to `prose`, and the routing tool loaded it
for itself. The routing tool imported `agentIds` from `agents`
(`main/tools/index.ts`, migration brief, hard seams 1 and 2).

v2 keeps one install and one plugin id. It gives each capability its own block,
surfaces, tests, and failure. The aggregator disappears, and a block imports its
own internals and nothing else. When two blocks need the same fact, one owns it
and the other reads it through a contract (migration brief, hard seams and
rubric).

The move is incremental. Every slice leaves a tree that loads and typechecks,
and a moved capability carries its tests (migration brief, "Migration order").

## The honest cost

The host reports one plugin, not one state per block. `opencode plugin list`
shows the plugin id, and the host has no row for a block (`README.md`,
`main/AGENTS.md`). A failed block appears as an `Effect.logError` line from the
bundle, not as host status (`packages/core/bundle.ts`).

That is the price of one install unit. The isolation is real inside the bundle,
and the host boundary is still one plugin. Do not describe block health as
host-visible, and do not add a plugin per block to make it visible.

A second cost is the lazy transform. A block can register a surface the
`Surfaces` value does not name, and no session will catch it. Only
`surfaceProblems` in the test harness catches it (`packages/core/surface.ts`). A
block without a surface test is a block whose declaration can drift.

## What the project optimizes for

**Reader load.** Reader load is the number of files a person must open to answer
one question. The core is small, a block is one folder, and a feature document
states the requirement once with its sources (`main/features/README.md`). The v1
documents carry the evidence a reader would otherwise gather
(`main/features/canvas.md`, `main/features/brain.md`).

**Evidence over assertion.** A design claim carries the file, command, or
measurement that proves it. `main/AGENTS.md` requires source reads at the tag,
not at `dev`. `main/features/canvas.md` measured a wrong diff count before it
built a parser, and `main/features/brain.md` derives evidence from git so a model
cannot write its own. A claim cites its file.

**One source per decision.** The routing block has one normalizer for the model
catalogue, with two callers, because two readers drift
(`main/features/routing.md`). `main/features/README.md` has three readers of one
config and no duplicate. In v2 one block owns a fact, and the other receives it
through a contract.

**A loadable tree after every slice.** The package has no build step, so a tree
that does not typecheck is a plugin that does not load (`README.md`,
`main/AGENTS.md`). Every migration commit leaves the entrypoint resolving and
the typecheck clean, and a moved capability carries its tests. The migration
brief makes that a condition of each slice.

## The test for a design change

A change fits Spectre v2 when it names one capability, gives it one block, and a
maintainer proves it with `runBlock` and `surfaceProblems`. A second plugin, a
second registration API, or an import between two blocks means the design is wrong.
