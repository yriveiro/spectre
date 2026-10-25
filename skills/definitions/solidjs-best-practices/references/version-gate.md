# Version gate

Every answer in this skill depends on one question: which Solid line does the project install? Stable 1.9 and the 2.0 release candidate share a mental model and almost no API. SolidStart adds a second question, because the stable 2.x line runs Solid 1.9. Answer both before writing code.

## The matrix

| Package | Stable line | Next line | What it means |
| --- | --- | --- | --- |
| `solid-js` | `1.9.17` (`latest`) | `2.0.0-rc.18` (`next`) | The core API. `1.10.0-beta.0` is a v1 beta, not v2. |
| `@solidjs/web` | stale `2.0.0-rc.0` (`latest`) | `2.0.0-rc.18` (`next`) | DOM runtime, JSX runtime, `render`/`hydrate`, `Portal`, `dynamic`. Peer: `solid-js ^2.0.0-rc.18`. |
| `@solidjs/signals` | stale `2.0.0-rc.0` | `2.0.0-rc.18` | The reactive core `solid-js` 2 re-exports. |
| `@solidjs/router` | `1.0.0` | `2.0.0-next.42` | Router 1 peers `solid-js ^1.8.6`; router 2 peers `solid-js ^2.0.0-rc.17` and `@solidjs/web ^2.0.0-rc.17`. |
| `@solidjs/meta` | `0.29.4` | `1.0.0-next.2` | Meta 0.29 peers `solid-js >=1.8.4`; meta 1 next peers `solid-js ^2.0.0-rc.0`. |
| `@solidjs/start` | `2.1.0` (`latest`) | `1.4.0` (`v1-latest`) | **Both run Solid 1.9.** Start 2 peers `solid-js ^1.9.15`, `@solidjs/router >=0.16 <2.0.0-0`, `vite ^8 \|\| ^9`, Node `>=24`. Start 1 peers `vinxi ^0.5.7`. |
| `vite-plugin-solid` | `2.11.14` | `3.0.0-next.27` | The Solid 1.9 Vite plugin. Peers `solid-js ^1.7.2`. |
| `@solidjs/vite-plugin` | `3.0.0-next.51` (published as `latest`) | same | The Solid 2.0 Vite plugin. Peers `solid-js ^2.0.0-rc.16`, `@solidjs/web ^2.0.0-rc.16`, Vite `^8 \|\| ^9`. Its "start" mode is **not** SolidStart. |
| `@solidjs/testing-library` | `0.8.10` | `1.0.0-rc.2` | 0.8 peers `solid-js >=1.0.0`; 1.0 RC peers `solid-js >=2.0.0-0` and `@solidjs/web >=2.0.0-0`. |

`verified.ts` and `sources-and-maintenance.md` carry the version and date stamp. A refresh moves both.

## The three layers

```
Solid 1.9 core  ──►  SolidStart 1 (Vinxi/Nitro 2)
                └─►  SolidStart 2 (Vite 8/Nitro 3)  ── still solid-js 1.9

Solid 2.0 RC core ──►  @solidjs/vite-plugin (Vite 8/Nitro 3 "start" mode)
                   └─►  @solidjs/router 2 next
                   └─►  @solidjs/meta 1 next
```

The middle row is the trap. `@solidjs/start@2` is newer than `@solidjs/start@1`, but "2" is the **SolidStart** major, not the Solid major. Its peer range is the proof:

```json
{
  "@solidjs/start": "2.1.0",
  "peerDependencies": {
    "@solidjs/router": ">=0.16.0 <2.0.0-0",
    "solid-js": "^1.9.15",
    "vite": "^8 || ^9"
  },
  "engines": { "node": ">=24" }
}
```

Do not describe SolidStart 2 as "Solid 2 support". It is not. A Solid 2 app that needs fullstack routing uses the `@solidjs/vite-plugin` line and the router 2 next line, and should say so explicitly.

## Detect by hand

Read these in order. The first one that answers is not always the truth, so read the next two as corroboration.

1. **`package.json` dependencies, devDependencies, peerDependencies, optionalDependencies.** A declared `solid-js` range answers the core line. A `workspace:*` or `catalog:` range does not; follow it to the workspace root or the catalog.
2. **The lockfile.** `bun.lock`, `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`. The lockfile is what actually runs. A manifest that says `^1.9.0` with a lockfile at `2.0.0-rc.18` is not a v1 app; it is a broken install.
3. **`tsconfig.json` / `jsconfig.json`.** `"jsxImportSource": "solid-js"` is the 1.x runtime. `"jsxImportSource": "@solidjs/web"` is the 2.0 runtime. `"solid-js"` plus a `solid-js` 2 dependency is an error, not a preference.
4. **The build config.** `app.config.ts` with `defineConfig` from `@solidjs/start/config` is SolidStart 1. `vite.config.ts` with `solidStart()` from `@solidjs/start/config` is SolidStart 2. `vite-plugin-solid` is the 1.x Vite plugin. `@solidjs/vite-plugin` is the 2.0 Vite plugin.
5. **Imports.** `solid-js/web`, `solid-js/store`, `solid-js/h`, `solid-js/html`, and `solid-js/universal` are 1.x subpaths. `@solidjs/web`, `@solidjs/h`, `@solidjs/html`, and `@solidjs/universal` are 2.0 packages. A store import from `solid-js` directly is 2.0.
6. **JSX.** `<Suspense>`, `<SuspenseList>`, `<ErrorBoundary>`, and `<Index>` are 1.x. `<Loading>`, `<Reveal>`, `<Errored>`, and `<Repeat>` are 2.0.

The detector does all six and returns the evidence with file and line. Treat its `warnings` as questions: "lockfile supplied the version" and "source imports are the only evidence" both mean the manifest is incomplete.

## API availability

| API | Solid 1.9 | Solid 2.0 RC |
| --- | --- | --- |
| `createSignal`, `createMemo`, `createEffect`, `createRoot`, `createContext`, `useContext`, `children`, `lazy`, `untrack`, `onCleanup` | Yes | Yes, with changed options and effect shape |
| `createEffect(fn)` | Yes | No; `createEffect(compute, apply)` only |
| `createEffect(fn, initialValue)` | Yes | No; compute receives `prev` |
| `createMemo(fn, initialValue)` | Yes | No; second argument is options |
| `batch` | Yes | Removed; updates batch per microtask, `flush()` forces sync |
| `onMount` | Yes | Removed; `onSettled` |
| `on` | Yes | Removed; the compute phase declares dependencies |
| `createComputed` | Yes | Removed; `createMemo`, split `createEffect`, `createSignal(fn)` |
| `createResource` | Yes | Removed; async `createMemo`/`createStore(fn)` + `Loading` |
| `createSelector` | Yes | Removed; `createProjection` / `createStore(fn)` |
| `createMutable`, `modifyMutable`, `produce` | Yes | Removed; draft setters are the default |
| `mergeProps`, `splitProps` | Yes | `merge`, `omit` |
| `unwrap` | Yes | `snapshot` |
| `startTransition`, `useTransition` | Yes | Removed; transitions are built in |
| `from` | Signal adapter | Returns an async iterable for a memo |
| `observable` | Yes | Removed; push with `createEffect` |
| `indexArray` | Yes | Removed; `mapArray` with `keyed: false` |
| `Index` | Yes | Removed; `<For keyed={false}>` |
| `Suspense` | Yes | `Loading` |
| `SuspenseList` | Yes | `Reveal` |
| `ErrorBoundary` | Yes | `Errored` |
| `Dynamic` | Yes | Kept but deprecated; `dynamic()` factory |
| `classList` | Yes | Removed; `class` object/array |
| `use:` directives | Yes | Removed; `ref` directive factories |
| `attr:`, `bool:`, `on:`, `oncapture:` | Yes | Removed; plain attributes and camelCase events |
| `solid-js/store` | Yes | Store APIs exported from `solid-js` |
| `solid-js/web` | Yes | `@solidjs/web` |
| `onSettled`, `createProjection`, `action`, `refresh`, `isPending`, `latest`, `until`, `affects`, `Loading`, `Errored`, `Reveal`, `Repeat` | No | Yes |
| `createOptimistic`, `createOptimisticStore` | No | Yes |
| `snapshot`, `merge`, `omit`, `flush`, `deep`, `reconcile` | No (except `reconcile` in store) | Yes |

When a name is missing from this table, check the installed package's own `CHEATSHEET.md` or `node_modules/solid-js/skills/solid-2.0/SKILL.md` for 2.0, and the v1 docs for 1.9. Do not fill the gap from memory.

## When the answer is mixed or unknown

- **Mixed imports in one file.** Stop. Move the file to one line, or split it into a v1 module and a v2 module with an explicit boundary. A file that imports `solid-js/web` and `@solidjs/web` has two runtimes and no coherent owner.
- **Solid 2 plus SolidStart.** Stop. Tell the user the supported pairing is `solid-js ^1.9.15` with `@solidjs/start 2.x`, and that Solid 2 fullstack is a different stack. Do not silently downgrade `solid-js`; the app's code may already use v2 APIs.
- **No manifest.** Ask. A file named `vite.config.ts` or a `createSignal` import does not distinguish 1.9 from 2.0. The `package.json` or the lockfile does.
- **A global install or a monorepo.** Detect from the package that owns the source file, not from the repository root. A workspace can hold a Solid 1.9 app and a Solid 2 RC package at once; each has its own `package.json` and its own JSX import source.
- **A published library.** Its `peerDependencies` are the contract, not its devDependencies. A library that peers on `solid-js >=1.9` cannot claim Solid 2 support until it widens the range and tests both lines.

## What to say in the report

Name the line and the evidence:

```
Version: solid-js 2.0.0-rc.18 (next), @solidjs/web 2.0.0-rc.18, @solidjs/router 1.0.0
Mode: solid-2
Evidence: package.json dependencies.solid-js = ^2.0.0-rc.18; tsconfig.json jsxImportSource = @solidjs/web
Caveat: 2.0 is a release candidate, not the stable line.
```

If the project is on 1.9, say stable. If it is on 2.0 RC, say release candidate every time. If it is on SolidStart 2, say "SolidStart 2.1.0 on Solid 1.9.17". The distinction is the whole point of the gate.
