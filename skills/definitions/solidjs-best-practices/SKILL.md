# SolidJS best practices

Solid is not React, and Solid 1.x is not Solid 2.0. A component runs once. Reads inside JSX, a memo, or an effect's compute function drive every update. The two live lines share that model and disagree about almost every API around it. `createEffect` takes one function in 1.x and two in 2.0. Stores take path writes in 1.x and draft writes in 2.0. `solid-js/web` becomes `@solidjs/web`, and `Suspense`/`ErrorBoundary` become `Loading`/`Errored`. Stable `@solidjs/start` 2.x still runs Solid 1.x. This skill gates on the exact installed version first. It then gives the smallest correct change for that version, the anti-pattern it punishes, and the check that proves it.

## The version gate is mandatory

Do not write or review Solid code until you establish one line. Call the tool before anything else:

```ts
const report = await tools.spectre.solidjs({ action: "detect", target: "." });

report.mode; // "solid-1" | "solid-2" | "mixed" | "unknown"
report.solid.line; // "1" | "2" | "unknown"
report.framework; // "solidstart-1" | "solidstart-2" | "none"
report.incompatible; // string[]
```

Read `mode`, `solid.line`, `framework`, and `incompatible`, not just the first line. If `mode` is `"unknown"`, ask which version the project uses. A `compatible: false` result means stop before you write code.

| What the project has | Mode | What you may write |
| --- | --- | --- |
| `solid-js` `^1.9.x`, `jsxImportSource: "solid-js"` | `solid-1` | Solid 1.9 APIs only. `solid-js/web`, `solid-js/store`, `onMount`, `createResource`, `batch`, `Index`, `Suspense`. |
| `solid-js` `2.0.0-rc.*`, `@solidjs/web` `2.0.0-rc.*`, `jsxImportSource: "@solidjs/web"` | `solid-2` | Solid 2.0 RC APIs only. Split `createEffect`, `onSettled`, draft stores, `Loading`/`Errored`, `For keyed`, `@solidjs/web`. Say **RC**, never "stable". |
| `@solidjs/start` `2.x` + `solid-js` `^1.9.x` | `solidstart-2` | SolidStart 2 APIs with Solid 1.9 core APIs. This is the supported pairing. |
| `@solidjs/start` `1.x` + Vinxi + `app.config.ts` | `solidstart-1` | SolidStart 1 APIs with Solid 1.9 core APIs. |
| `solid-js` 2 + `@solidjs/start` any | incompatible | Stop. SolidStart does not run Solid 2. Keep Solid 1.9 or drop SolidStart. |
| Both 1.x and 2.0 imports, or `mode: "mixed"` | `mixed` | Stop and pick a line. Never translate half a module. |
| No manifest and no imports | `unknown` | Ask which version is installed. Do not infer from a filename. |

Three facts that decide most cases:

- **`@solidjs/start@2.1.0` peers on `solid-js ^1.9.15`.** It is stable and it is not Solid 2. The `@solidjs/vite-plugin` "start" mode is a separate Solid 2 fullstack stack, not SolidStart.
- **`solid-js@next` is `2.0.0-rc.18`; `solid-js@latest` is `1.9.17`.** A caret range, a lockfile, and a dist-tag can disagree. The lockfile wins for what runs; the manifest wins for what the project asked for.
- **`@solidjs/web@latest` is stale at `2.0.0-rc.0`.** The 2.0 line publishes `next`; pin `2.0.0-rc.18` or whatever the project's lockfile resolved.

`references/version-gate.md` holds the full dependency and peer matrix, the API availability table, and the by-hand detection procedure.

## The nine-step workflow

Every task that touches Solid code runs these, in order. Skip one only by saying why in the report.

1. **Detect the version and the framework layer.** Call `tools.spectre.solidjs({ action: "detect" })`. Record `solid-js`, `@solidjs/start`, `@solidjs/router`, `@solidjs/meta`, `@solidjs/web`, the JSX import source, and the build plugin. If the detector says `unknown`, `mixed`, or `compatible: false`, stop and ask.
2. **Inspect the actual code before changing it.** Read the component, its parent, the store or context that feeds it, and the config. A prop that "does not update" is usually read once in the child, not missing from the parent. Find the owner before adding a cleanup.
3. **Consult the authoritative source for that exact version.** Solid 1.9: `https://docs.solidjs.com` (the v1 docs). Solid 2.0 RC: `https://v2.solidjs.com`, plus `node_modules/solid-js/CHEATSHEET.md` and `node_modules/solid-js/skills/solid-2.0/SKILL.md` when installed. SolidStart 1: `/solid-start/v1/…`; SolidStart 2: `/solid-start/v2/…`. Do not use a v2 page to justify v1 code, or the reverse.
4. **Write the simplest correct solution.** Derive before you store; store before you effect; effect only at the edge where Solid must touch something it does not own. Add no primitive the problem does not require.
5. **Preserve reactivity and types.** Keep `props` intact and read `props.x` where it is used. Do not pass an accessor where a value is expected. Keep generics on `Component`, `For`, stores, and query functions. If a cast is needed to make it compile, the shape is usually wrong.
6. **Review against the anti-pattern catalogue.** `references/anti-patterns.md` is organized by symptom. Check the entries tagged for the detected version, not the whole file.
7. **Check accessibility, SSR/hydration, and performance.** Labels and keyboard paths; no browser globals during render; no `Date.now()`/`Math.random()` in rendered output; lists keyed by identity; no request waterfall introduced by an effect.
8. **Run the checks.** `tools.spectre.solidjs({ action: "audit" })` must report zero errors. The project's `tsc`/`vite build`/tests must pass. If the change is a migration, run the old and new examples side by side before deleting the old path.
9. **Report what was verified and what was assumed.** Name the version, the files changed, the commands run and their results, and every claim you could not check. "It should work" is not a result.

## Drop the React assumptions first

Most broken Solid code is React code with Solid imports. These are the tells, and the audit catches the mechanical ones.

| React habit | Solid 1.9 | Solid 2.0 RC |
| --- | --- | --- |
| Component re-renders on state change | Runs once. JSX expressions track. | Same. |
| `useState` / `useEffect` / `useMemo` | `createSignal` / `createEffect` / `createMemo` | Same names, split effect. |
| Dependency array | None. Reads in the tracked scope are the dependencies. | Same; the compute function is the dependency declaration. |
| Destructured props | Freezes the value. Keep `props`. | Freezes the value and warns `STRICT_READ_UNTRACKED`. |
| `value={count}` | Passes the accessor, not the number. Call it: `value={count()}`. | Same. |
| `className` / `htmlFor` | `class` / `for` | Same. |
| `key={item.id}` | `<For each={items()}>` keys by identity. | `<For each={items()} keyed={(item) => item.id}>`. |
| `items.map(...)` in JSX | `<For>`; `<Index>` for a stable shape. | `<For>`; `keyed={false}` for index semantics. |
| `useContext` returns `T \| undefined` | Yes, unless a default was given. | Default-less context returns `T` and throws if unprovided. |
| `style={{ color }}` | Supported. | Supported. |
| `useMemo` everything | A plain function is enough until the derivation is shared or expensive. | Same. |

## Decide the primitive

**Solid 1.9**

| Need | Reach for |
| --- | --- |
| One changing value | `createSignal` |
| Derived value, shared or expensive | `createMemo` |
| Derived value, cheap and one reader | a plain function called from JSX |
| Side effect at the edge | `createEffect`; `onMount` for once-only setup; `onCleanup` for teardown |
| Async read tied to an input | `createResource(source, fetcher)`, then `loading`/`error`/`refetch` |
| Structured state | `createStore` + path setters, `produce`, `reconcile` |
| Many updates at once | `batch` |
| Read without subscribing | `untrack` |
| Explicit dependencies | `on(dep, fn, { defer })` |
| List by identity / by index | `<For>` / `<Index>` |

**Solid 2.0 RC**

| Need | Reach for |
| --- | --- |
| One changing value | `createSignal`; reads update after the microtask flush |
| Writable derived value | `createSignal(() => expr)` |
| Derived value | `createMemo`; async is allowed and reads as pending |
| Side effect | `createEffect(compute, apply)`; return cleanup from `apply` |
| Once-after-settle setup | `onSettled(() => { setup(); return cleanup; })` |
| Async read | async `createMemo` or `createStore(fn, seed)`, under `<Loading>` |
| Derived collection | `createProjection(fn, seed, { key })` |
| Mutation with optimistic UI | `action(function* () { ... })`, `createOptimisticStore`, `refresh` |
| In-flight indicator | `isPending(() => expr)`; `affects(target)` before a bare `refresh` |
| Structured state | `createStore` + draft setters, `reconcile`, `snapshot`, `merge`, `omit` |
| Many updates at once | nothing: batching is the default; `flush()` only to force sync |
| List by identity / by index | `<For>` / `<For keyed={false}>` |

## The rules that survive both versions

- **A component body is not a tracking scope.** A read there is a one-time value. Read in JSX, a memo, or an effect's compute function. Use `untrack` only when the one-time read is the intent.
- **Props are reactive at the property access.** Keep the object; read `props.x` where it is used. `splitProps` (1.9) and `omit` (2.0) are the supported ways to separate them.
- **Derive, do not mirror.** If a value can be computed from existing state, compute it where it is read. An effect that writes a signal from another signal is a frame behind and a bug waiting for a second writer.
- **An effect is for the edge.** DOM APIs, subscriptions, logging, third-party widgets, and fetches whose result is not a derived value. If the effect writes state that other code reads, it is probably a derivation.
- **Every subscription has an owner and a cleanup.** `onCleanup` in 1.9; return a cleanup from the apply phase in 2.0. Async work needs an `AbortController` or a generation check, or a late response will overwrite a newer one.
- **Lists are keyed by identity unless the shape is the point.** A row component that keeps local state must not be recreated because an index moved.
- **SSR is a second runtime.** `window`, `document`, `localStorage`, `Date.now()`, and `Math.random()` during render produce a server string the client cannot reproduce. Guard or defer them.
- **A type error is evidence.** Do not cast around a prop, store, or event mismatch; the mismatch is usually the reactivity bug.

## References

Load only what the task needs. Every file is version-tagged where the answer differs.

| File | Read it when |
| --- | --- |
| `references/version-gate.md` | The detector is ambiguous, or you need the dependency/peer matrix and the API availability table. |
| `references/solid-v1.md` | Writing or reviewing stable Solid 1.9 code. |
| `references/solid-v2.md` | Writing or reviewing Solid 2.0 RC code. |
| `references/reactivity.md` | A value does not update, an effect loops or runs twice, cleanup is missing, or an async response races. |
| `references/components-and-composition.md` | Props, children, context, control flow, lists, refs, forms, and accessibility. |
| `references/typescript.md` | Component, prop, event, store, or JSX types; `tsconfig`; `jsxImportSource`. |
| `references/performance.md` | A list is slow, a derivation is recomputed, a bundle is large, or SSR is a waterfall. |
| `references/ssr-and-solidstart.md` | SSR, hydration, SolidStart 1 vs 2, routes, server functions, sessions, serialization, deployment. |
| `references/migration-v1-v2.md` | Moving an app from Solid 1.9 to 2.0, or SolidStart 1 to 2. |
| `references/anti-patterns.md` | Reviewing a diff, or a symptom needs a name, a cause, and a corrected example. |
| `references/testing-and-review.md` | Writing tests, choosing a test environment, or running the review checklist. |
| `references/sources-and-maintenance.md` | Checking provenance, refreshing the skill, or separating stable from experimental. |

## Checks

From a session:

```ts
await tools.spectre.solidjs({ action: "detect", target: "." });
await tools.spectre.solidjs({ action: "audit", target: "." });
await tools.spectre.solidjs({ action: "audit", target: ".", rule: "props-destructured" });
```

`audit` returns `status: "ok"` with `findings`, `errors`, `warnings`, and `total`, or `status: "refused"` when `target` is not a directory. `errors` counts the filtered set, and `truncated` says whether `limit` hid part of it. A `warn` finding is a review item. An `error` finding is a failure.

From a project that installed the skill's example toolchain:

```sh
bun run typecheck                                # tsc --noEmit
bun test                                         # unit and component tests
bun run build                                    # the framework's production build
```

`scripts/typecheck-examples.ts` compiles the skill's own v1 and v2 examples against the pinned versions in a scratch directory. It is the maintenance check, not a project check: run it after a version refresh, not on every task.

Pass means four things: the detector named one line, the audit reported zero errors, and the compiler accepted the file against that line's packages. The test also exercised the behavior. A warning is a question to answer, not a failure to suppress.

## Provenance

Checked **2026-10-25** against `solid-js` `1.9.17` (stable) and `2.0.0-rc.18` (next). The check also covered `@solidjs/start` `1.4.0` (v1) and `2.1.0` (latest). It covered `@solidjs/router` `1.0.0` (stable) and `2.0.0-next.42` (next), and `@solidjs/meta` `0.29.4` and `1.0.0-next.2`. The check also covered `@solidjs/web` `2.0.0-rc.18`, the official migration guide, and the docs corpora. The exact URLs and the refresh procedure are in `references/sources-and-maintenance.md`.

Solid 2.0 is a **release candidate**. It is not the stable line, its API can still move, and a production app should stay on 1.9 unless it has accepted that risk. SolidStart 2.x is stable but runs Solid 1.9. Do not describe it as Solid 2 support.
