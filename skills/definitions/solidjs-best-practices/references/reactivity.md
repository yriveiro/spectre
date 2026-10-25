# Reactivity, owners, and cleanup

Solid's model is small. A component runs once, a read inside a tracking scope subscribes that scope to the signal, and a write schedules the scopes that read it. Almost every bug called "reactivity" is a read in the wrong place or a subscription nobody disposed.

## Tracking scopes

A tracking scope is a function Solid runs while recording reads:

- a JSX expression (`{count()}`, `class={active()}`)
- a `createMemo` computation
- an effect's compute function (2.0) or the whole effect callback (1.9)
- a `createRenderEffect` / `createComputed` computation
- a `createResource` fetcher (the fetcher tracks the source read)
- a store property read, at property granularity

A component body is **not** a tracking scope. It runs once. A read there returns a value and subscribes nothing:

```tsx
function Bad() {
  const [count, setCount] = createSignal(0);
  const doubled = count() * 2; // computed once
  return <p>{doubled}</p>;     // never changes
}
```

The fix is to move the read into a scope, not to move the value:

```tsx
function Good() {
  const [count, setCount] = createSignal(0);
  const doubled = () => count() * 2;
  return <p>{doubled()}</p>;
}
```

Same rule for props. `props.count` is a getter. Destructuring calls it once in the body:

```tsx
// Wrong
function Bad({ count }: { count: number }) {
  return <p>{count}</p>;
}

// Right
function Good(props: { count: number }) {
  return <p>{props.count}</p>;
}
```

Solid 2.0 warns `STRICT_READ_UNTRACKED` for the first shape. Solid 1.9 fails silently, which is worse.

### Tracking is dynamic

There is no dependency array. Each run records the reads that actually happened. A conditional read subscribes only while the branch runs:

```tsx
createEffect(() => {
  if (enabled()) {
    console.log(value()); // subscribes to value only while enabled() is true
  }
});
```

This is a feature and a trap. If a read should happen on every run regardless of a branch, read it before the branch or use `on` (1.9). If a read should not subscribe, wrap it in `untrack`.

### Tracking stops at the owner boundary

A nested `createEffect`, `createRoot`, or component creates its own scope. Reads inside it do not subscribe the outer scope. This is why a `For` callback can read an item without making the parent list re-run.

In 2.0, flow callbacks (`<For>`, `<Show>`, `<Match>`) are **owners but not tracking scopes**. Read their accessor arguments in JSX, not at the top of the callback:

```tsx
<For each={items()}>
  {(item) => {
    const label = item().name; // wrong: read once, outside a tracking scope
    return <p>{label}</p>;
  }}
</For>
```

```tsx
<For each={items()}>
  {(item) => <p>{item().name}</p>}
</For>
```

## Derive, do not mirror

Compute a value from existing state where you read it. An effect that copies one signal into another is a frame behind and adds a second writer:

```tsx
// Wrong: the subtotal updates one flush after the items
const [subtotal, setSubtotal] = createSignal(0);
createEffect(() => setSubtotal(items().reduce((sum, item) => sum + item.price, 0)));

// Right: derive it
const subtotal = () => items().reduce((sum, item) => sum + item.price, 0);
```

Use `createMemo` when several readers share the derivation, when the derivation is expensive, or when propagation should stop while the result stays unchanged. A memo is a compute node. A plain function is not. For a cheap expression with one reader, the function is smaller and has no lifecycle.

Solid 2.0 reports the mirror pattern as `EFFECT_RELAY_TEAR`. The effect writes its compute output into a signal that nothing else writes. Every reader of the copy then paints a frame behind every reader of the source.

## Effects are for the edge

An effect belongs where a settled value has to leave Solid and drive something Solid does not own:

- a DOM API (`document.title`, `focus`, a canvas, a measurement)
- a subscription or event listener on an external object
- a third-party widget
- logging or analytics
- a fetch whose result is not a derived value (and even then, an async memo is usually better)

An effect is the wrong tool for:

- computing a value from state (derive it)
- synchronizing two pieces of state (derive one from the other, or use one source)
- reacting to a prop to update local state (use a function-form signal in 2.0, or a memo)
- fetching on every keystroke without cancellation (use an async memo or a resource with an abort)

### Effect timing

**Solid 1.9.** `createEffect` runs after render, before the browser paints in most cases but not guaranteed before paint. `createRenderEffect` runs during the render phase, before the DOM is connected. `createComputed` runs immediately and synchronously. `onMount` is a non-tracking effect that runs once after the initial render.

**Solid 2.0.** The compute phase runs in the reactive pass; the apply phase runs after the queue flushes. `createRenderEffect` remains for renderer plumbing. `onSettled` runs once after the first settle and can return cleanup.

Do not rely on the relative order of two effects. If one must observe the result of another, derive the value or sequence the work explicitly.

### Cleanup and owners

Every computation has an owner. `onCleanup` registers a function with the current owner, and the owner runs that function on disposal. Solid disposes a component's owner when the component unmounts. A `createRoot` creates an owner you dispose explicitly.

```tsx
const dispose = createRoot((dispose) => {
  const [count, setCount] = createSignal(0);
  const id = setInterval(() => setCount((value) => value + 1), 1000);
  onCleanup(() => clearInterval(id));
  return dispose;
});

dispose();
```

**Solid 1.9:** a `createRoot` nested inside another owner is kept out of that owner's `owned` list and lives until its own `dispose()` is called.

**Solid 2.0:** a nested root is a child of its parent and is disposed with it. To keep the 1.x lifetime, detach explicitly:

```tsx
const dispose = runWithOwner(null, () =>
  createRoot((dispose) => {
    onCleanup(() => controller.destroy());
    return dispose;
  })
);
```

**Solid 2.0 ref callbacks are unowned.** `getOwner()` is `null` inside, so `onCleanup` registered there never runs. Put the lifecycle work in `onSettled` or in a directive factory's owned setup phase.

### Async cleanup

An async effect or event handler outlives the render that started it. You need two guards: cancel the work, and ignore a result that belongs to an older request.

```tsx
// Solid 1.9
createEffect(() => {
  const id = userId();
  const controller = new AbortController();

  fetch(`/api/users/${id}`, { signal: controller.signal })
    .then((response) => response.json())
    .then((user) => {
      if (!controller.signal.aborted) setUser(user);
    })
    .catch((error) => {
      if (error.name !== "AbortError") setError(error);
    });

  onCleanup(() => controller.abort());
});
```

```tsx
// Solid 2.0
createEffect(
  () => userId(),
  (id) => {
    const controller = new AbortController();

    fetch(`/api/users/${id}`, { signal: controller.signal })
      .then((response) => response.json())
      .then((user) => {
        if (!controller.signal.aborted) setUser(user);
      })
      .catch((error) => {
        if (error.name !== "AbortError") setError(error);
      });

    return () => controller.abort();
  }
);
```

A generation counter is the alternative when the API cannot take a signal:

```tsx
let generation = 0;
createEffect(() => {
  const current = ++generation;
  load(userId()).then((result) => {
    if (current === generation) setData(result);
  });
});
```

`AbortController` is better: it stops the request instead of only ignoring the result.

## Batching

**Solid 1.9.** Writes notify synchronously, but downstream computation is batched inside effects, `onMount`, and store setters. `batch(fn)` defers the whole callback. A read inside the batch may force an on-demand update of a stale memo.

**Solid 2.0.** Every write is batched per microtask. `setX(1); x()` returns the previous value until the batch flushes. `flush()` forces the queue to drain synchronously; use it in tests and rare imperative interop, not as a normal control-flow tool.

A write inside an effect's apply phase starts a second pass inside the same flush. Readers of the written signal update one pass after readers of the source, which is the tear `EFFECT_RELAY_TEAR` reports.

## Debugging by symptom

| Symptom | Likely cause | Check |
| --- | --- | --- |
| Value never updates | Read in the component body or destructured props | Move the read into JSX/a memo; keep `props` intact |
| Value updates once, then freezes | Signal captured in a closure created once | Read the accessor at use time; do not pass `count` where `count()` is meant |
| Effect runs twice on mount | Development double-invoke, or a write in the effect | Check for a write that re-triggers; 2.0 effects do not compare values |
| Effect loops forever | Effect writes a signal it reads | Derive instead, or guard the write |
| Cleanup never runs | Registered in an unowned scope (2.0 ref callback, detached async callback) | Move it into `onSettled`, a directive setup, or the effect apply return |
| Old request overwrites new data | No abort or generation check | Add `AbortController` or a generation counter |
| List rows lose focus/state on reorder | `.map()` or index-keyed rendering | `<For>` by identity; `<Index>` only when the shape is stable |
| Hydration mismatch | `Date.now()`, `Math.random()`, `window` during render | Compute on the server, or render after mount |
| Context is undefined | No provider above the reader (1.9) | Add the provider or a default; 2.0 throws instead |

## Version differences at a glance

| Concern | Solid 1.9 | Solid 2.0 RC |
| --- | --- | --- |
| Effect shape | `createEffect(fn, initialValue?)` | `createEffect(compute, apply)` |
| Once-only setup | `onMount` | `onSettled` |
| Explicit deps | `on(dep, fn, { defer })` | compute function |
| Batching | `batch(fn)` | automatic; `flush()` |
| Derived writable value | `createMemo` + effect, or `createSignal` + `createComputed` | `createSignal(fn)` |
| Async read | `createResource` | async memo/store + `Loading` |
| Error boundary | `ErrorBoundary` | `Errored` |
| Nested root lifetime | Independent until disposed | Child of parent; `runWithOwner(null, ...)` to detach |
| Ref callback owner | Owned | Unowned |
| Top-level read warning | None (silent) | `STRICT_READ_UNTRACKED` |
| Write in owned scope | Allowed, discouraged | Throws in development |

## The test

Before adding a primitive, answer these in order:

1. Can this value be computed from state I already have? If yes, derive it.
2. Does the derivation need to be shared or expensive? If yes, memoize it.
3. Does the work have to leave Solid (DOM, network, subscription)? If yes, effect it.
4. Does it outlive the call? If yes, return or register a cleanup.
5. Can a late result arrive after a newer one? If yes, cancel it or check a generation.
6. Is the read inside a tracking scope? If no, move it or say `untrack`.

If the answer to (3) is no, there is no effect in the solution.
