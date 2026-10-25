# Performance

Solid is fast by default because it does less. A component runs once, a signal update touches only the expressions that read it, and there is no virtual DOM diff. Most performance work is therefore about not adding work back. The usual ways back are extra memos, broad store reads, unkeyed lists, request waterfalls, and bundles that ship code the first screen never uses.

## Measure before changing

1. **Reproduce with a number.** A trace, a profile, a Lighthouse run, a server timing header, a bundle report. "Feels slow" is not a target.
2. **Name the cost.** Render work, reactive recomputation, network waterfall, bundle parse, or hydration.
3. **Change one thing.** Re-measure the same scenario. If the number did not move, revert.
4. **Keep the behavior test.** A performance change that changes output is a behavior change and needs its own test.

Useful instruments:

- Browser Performance panel: long tasks, layout shifts, scripting time.
- `performance.mark`/`measure` around a suspected derivation or route transition.
- Vite's build report (`vite build --mode production`, then a bundle analyzer) for shipped bytes.
- Solid 2.0 diagnostics (`@solidjs/diagnostics`, the dev server's `whyDidRun` and `costs` endpoints) when you enable attribution. They name the scope that re-ran and why.
- Server logs and `Server-Timing` for SSR waterfalls.

## Reactive cost model

| Operation | Cost |
| --- | --- |
| Signal read in a tracking scope | A subscription check; cheap |
| Signal write | Marks subscribers; schedules a flush |
| Memo | A node, an equality check, and a cache entry |
| Plain function derivation | The computation, every time it is read |
| Store property read | A proxy get and a property-level subscription |
| Store draft write | A proxy set and a notification for the touched path |
| Effect | A compute pass, an apply pass, and a cleanup slot |
| Component | One function call for the life of the instance |

The practical rules:

- **A memo is not free.** Use it when the derivation is shared, expensive, or needs to stop propagation. A cheap expression with one reader is smaller as a plain function called from JSX.
- **A store read is narrow.** Reading `state.user.name` does not subscribe to `state.todos`. Keep the read as deep as the value you need; do not read the root and pass it around if the child only needs one field.
- **A broad read is a broad subscription.** `const all = state` at the top of a component and then `all.user.name` in JSX reads the root. Read `state.user.name` directly.
- **An effect adds a second pass.** A write inside an effect starts another pass in the same flush. Derive instead.
- **A component that creates a primitive per item is fine** if the item identity is stable. The problem is recreating the item, not creating the primitive.

## Lists

The list is where most apps lose frame time.

- **Use `<For>` for identity-keyed lists.** `<For>` moves existing DOM nodes when an item moves; `.map()` recreates them, losing focus, selection, and component state.
- **Use `<Index>` (1.9) or `<For keyed={false}>` (2.0) for a stable shape.** A fixed table of cells should not recreate every row when one value changes.
- **Do not create an accessor per row unless the row needs one.** In 2.0, `keyed={false}` gives one; call it in JSX.
- **Virtualize only when the count justifies it.** A few hundred rows of simple DOM are usually fine. Thousands of complex rows need windowing; measure first.
- **Avoid a derived array that is recreated on every read.** `items().filter(...)` in JSX creates a new array on every read and defeats identity. Put it in a `createMemo` or a `createProjection` so the array is stable between changes.

```tsx
// Wrong: a new array every time the JSX reads it
<For each={items().filter((item) => item.active)}>{...}</For>

// Right: one derived array, reconciled
const active = createMemo(() => items().filter((item) => item.active));
<For each={active()}>{...}</For>
```

In 2.0, `createProjection` is better than `createMemo` when the filtered result is a collection of store rows and row identity matters:

```tsx
const active = createProjection<User[]>(() => users().filter((user) => user.active), []);
```

## Stores and projections

- **Write the narrowest path.** In 1.9, `setState("user", "name", value)` touches one property; replacing the root touches everything that reads it.
- **Use `produce` (1.9) or a draft (2.0) for a multi-step update.** One setter call is one notification batch.
- **Use `reconcile` when server data arrives.** It preserves identity for unchanged rows; replacing the array recreates every row.
- **Use `createProjection` for a derived collection.** It reconciles by key and keeps per-property tracking, which a plain `filter` inside JSX does not.
- **Do not `snapshot` on every read.** `snapshot(store)` walks the store and produces a plain object. Do it at a boundary, not in a render path.

## Async and waterfalls

A waterfall is the most expensive "reactivity" bug because it looks like a slow network.

- **Start independent requests together.** `Promise.all` in a route loader or a resource fetcher, not one effect that awaits another.
- **Lift shared reads to the route.** Two components that fetch the same user should read one query/resource at their common owner. SolidStart's router queries and single-flight mutations exist for this.
- **Do not fetch in an effect when a derived read will do.** An async memo or a route query lets the router and the server coordinate the read; an effect starts after render and cannot participate in SSR streaming.
- **Cancel superseded requests.** A search that fires on every keystroke without an abort sends N requests and renders whichever lands last. Debounce the input and abort the previous request.
- **Stream what can stream.** In SSR, a slow section under `<Suspense>`/`<Loading>` can stream after the shell. Do not `deferStream` everything; that turns a stream into a wait.
- **Prefetch on intent.** SolidStart route preload and `preload` functions start the read before navigation. Use them for the next likely route, not every link.

## Code splitting

- **Route-level splitting is the default in SolidStart.** Each route is lazy-loaded; keep the boundary at the route, not at every component.
- **`lazy(() => import("./Heavy"))`** for a component that is not needed on first render. Put it under a boundary so the fallback is deliberate.
- **`clientOnly(() => import("./Widget"), { lazy: true })`** in 2.0 for a browser-only component that must not server-render. It avoids Suspense and never server-renders.
- **Do not split a component that is always rendered with its parent.** The extra request costs more than the bytes saved.
- **Check what the vendor chunk contains.** A UI library imported for one icon can dominate the bundle. Import the icon, not the barrel.

## SSR performance

- **Render the shell first.** Put slow data under a boundary that can stream.
- **Avoid a browser-global branch that forces a client-only render.** It ships a blank shell and hydrates late.
- **Serialize only what the client needs.** A huge store serialized into the hydration payload costs bytes and parse time. Return the page's data, not the whole cache.
- **Keep the server render pure.** A `Date.now()` or a random value in render is both a hydration bug and a cache-defeating one.
- **Cache at the query layer, not the component.** A component-level cache is per request and per owner; a router query cache or an HTTP cache is shared.

## Version differences

| Concern | Solid 1.9 | Solid 2.0 RC |
| --- | --- | --- |
| Batching | `batch(fn)` for multiple writes | automatic per microtask |
| Derived collection | `createMemo` + `<For>` | `createProjection` |
| Async read | `createResource` | async memo/store |
| Streaming hold | `deferStream` on resource/query | `deferStream` or `ssrSource` |
| Diagnostics | dev warnings, no attribution | `@solidjs/diagnostics` attribution |
| List index mode | `<Index>` | `<For keyed={false}>` |
| Component split | `lazy` | `lazy` / `clientOnly` |

## The performance review

Ask these before calling a change done:

1. Does the change add a memo, an effect, or a store root read? Can it be a plain function or a narrower read?
2. Does a list recreate rows on reorder? Is the key the item identity?
3. Does a derived array get recreated on every read? Is it memoized or projected?
4. Does the change add a request after render that could be a route/query read?
5. Does it ship a component the first screen does not need?
6. Does it add a browser-only branch that delays hydration?
7. Did the measurement move? If not, is the change still justified for clarity? If yes, keep it and record the number.
