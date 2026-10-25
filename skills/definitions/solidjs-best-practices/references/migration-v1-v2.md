# Migrating Solid 1.9 to Solid 2.0

`solid-js@2` is a release candidate at the time of writing. A migration is a rewrite of runtime contracts, not a dependency bump. Do it on a branch, keep the 1.9 app runnable, and move one surface at a time.

## Decide before you start

| Question | If the answer is no |
| --- | --- |
| Is the target explicitly Solid 2? | stay on 1.9.17. Do not migrate "because it is newer" |
| Can the app ship on an RC? | stay on 1.9.17 until 2.0 is stable |
| Does the app use SolidStart? | stop. Released SolidStart 2 runs Solid 1 and does not support Solid 2. Move to a separate Solid 2 start-mode app only if the user asks for it |
| Are all UI dependencies compatible with Solid 2? | keep them on the 1.9 branch until they publish a v2 release |

The core migration and the framework migration are separate projects. `references/ssr-and-solidstart.md` covers the four stacks and why SolidStart cannot be upgraded to Solid 2.

## Order of work

Each step leaves the app runnable.

1. Record the baseline: `solid-js` version, router and meta versions, build tool, SSR mode, test command.
2. Move dependencies and build config.
3. Move imports, with no behavior change.
4. Split effects and replace lifecycle calls.
5. Move stores to draft setters.
6. Move control flow.
7. Move DOM bindings, refs, and directives.
8. Move async data and mutations.
9. Move context.
10. Fix TypeScript and `tsconfig`.
11. Re-run behavior tests and hydration checks.

Do not combine steps 4 through 8 in one commit. Each one has a distinct failure signature.

## 1. Dependencies and build

```jsonc
// package.json
{
  "dependencies": {
    "solid-js": "2.0.0-rc.18",
    "@solidjs/web": "2.0.0-rc.18"
  },
  "devDependencies": {
    "@solidjs/vite-plugin": "3.0.0-next.51"
  }
}
```

`@solidjs/web@latest` is stale at `2.0.0-rc.0`. Use `next` or the exact RC version. The core package, the web package, and the Vite plugin must come from the same RC line. `@solidjs/vite-plugin` peers on `solid-js ^2.0.0-rc.16`, `@solidjs/web ^2.0.0-rc.16`, and Vite `^8 || ^9`.

```ts
// vite.config.ts
import { defineConfig } from "vite";
import solid from "@solidjs/vite-plugin";

export default defineConfig({ plugins: [solid()] });
```

```json
// tsconfig.json
{
  "compilerOptions": {
    "jsx": "preserve",
    "jsxImportSource": "@solidjs/web",
    "moduleResolution": "bundler",
    "strict": true
  }
}
```

`jsxImportSource: "solid-js"` no longer works for web JSX. `solid-js` does not export the JSX namespace or the JSX runtime entries.

## 2. Import moves

| 1.9 | 2.0 |
| --- | --- |
| `solid-js/web` | `@solidjs/web` |
| `solid-js/store` | `solid-js` |
| `solid-js/h` | `@solidjs/h` |
| `solid-js/html` | `@solidjs/html` |
| `solid-js/universal` | `@solidjs/universal` |
| `solid-js/jsx-runtime` | `@solidjs/web/jsx-runtime` |

```ts
// 1.9
import { render } from "solid-js/web";
import { createStore, produce } from "solid-js/store";

// 2.0
import { render } from "@solidjs/web";
import { createStore } from "solid-js";
```

Do this as a pure move. If the app compiles after step 2, the rest of the migration has a clean starting point.

## 3. Effects and lifecycle

### Split effects

`createEffect` now takes a compute function and an apply function.

```ts
// 1.9
createEffect(() => {
  el().title = name();
});

// 2.0
createEffect(
  () => name(),
  (value) => {
    el().title = value;
  }
);
```

Rules:

- The compute function tracks. It must not write.
- The apply function receives the computed value and the previous value. It can return cleanup.
- The 1.x `initialValue` argument is gone. Use a default parameter on the compute function when you need a first value.
- `createMemo` no longer takes an initial value. Its second argument is an options object.

```ts
// 1.9
const doubled = createMemo((prev) => count() * 2, 0);

// 2.0
const doubled = createMemo(() => count() * 2);
```

### Cleanup

```ts
// 1.9
createEffect(() => {
  const id = setInterval(tick, 1000);
  onCleanup(() => clearInterval(id));
});

// 2.0
createEffect(
  () => interval(),
  (ms) => {
    const id = setInterval(tick, ms);
    return () => clearInterval(id);
  }
);
```

### `onMount` becomes `onSettled`

```ts
// 1.9
onMount(() => measureLayout());

// 2.0
onSettled(() => {
  measureLayout();
  const onResize = () => measureLayout();
  window.addEventListener("resize", onResize);
  return () => window.removeEventListener("resize", onResize);
});
```

`onSettled` runs only in the browser, after render settles, and its returned cleanup runs on disposal. It replaces `onMount` and the common `onMount` plus `onCleanup` pair.

### `on` helper

The `on` helper existed to control dependencies in a single-function effect. Split effects make it unnecessary.

```ts
// 1.9
createEffect(on(source, (value) => track(value), { defer: true }));

// 2.0
createEffect(
  () => source(),
  (value) => track(value)
);
```

### `createComputed`

Replace it with `createMemo` when it derives a value. Use a split `createEffect` when it performs a side effect. Use the function form of `createSignal`/`createStore` when it maintains derived state. Do not keep a write-only computed.

### Nested `createRoot`

A root created inside an owner now becomes a child of that owner, and that owner disposes it. To keep the 1.9 lifetime, detach explicitly:

```ts
const dispose = runWithOwner(null, () =>
  createRoot((dispose) => {
    onCleanup(() => controller.destroy());
    return dispose;
  })
);
```

## 4. Batching and reads

Solid batches updates by default on a microtask. A setter no longer changes what a read returns in the same tick.

```ts
setCount(1);
count(); // still the old value
flush();
count(); // 1
```

Consequences:

- Tests that assert immediately after a setter must `await` a microtask or call `flush()`.
- Code that reads a signal right after writing it is now suspicious. Derive the value instead.
- `batch()` is removed. `flush()` is the synchronization point.

## 5. Stores

### Draft setters

```ts
// 1.9
setStore("user", "address", "city", "Paris");
setStore("items", (items) => [...items, item]);
setStore(produce((draft) => { draft.count++; }));

// 2.0
setStore((s) => { s.user.address.city = "Paris"; });
setStore((s) => { s.items.push(item); });
setStore((s) => { s.count++; });
```

The draft function must not return a value. You need a block body when you mutate.

```ts
// wrong: returns a number, which may replace the store root
setStore((s) => s.items.push(item));

// right
setStore((s) => { s.items.push(item); });
```

### `unwrap` becomes `snapshot`

```ts
// 1.9
const plain = unwrap(store);

// 2.0
const plain = snapshot(store);
```

`snapshot` is the plain, non-reactive value. Do not use it inside JSX.

### `mergeProps` and `splitProps`

```ts
// 1.9
const merged = mergeProps(defaults, props);
const [local, rest] = splitProps(props, ["class", "style"]);

// 2.0
const merged = merge(defaults, props);
const rest = omit(props, "class", "style");
```

`merge` treats `undefined` as a real value. `{ b: undefined }` overrides `b`.

### `createMutable` and `modifyMutable`

Solid 2.0 removes both. Use `createStore` with draft setters. A mutable object that you pass around and mutate outside a setter no longer has a supported primitive.

### Derived stores

`createStore(fn, seed)` creates a derived store. `createProjection(fn, seed)` creates a refreshable derived store with reactive reconciliation.

```ts
const [items] = createStore(() => api.listItems(), []);
const [summary] = createProjection(
  (draft) => { draft.total = items.length; },
  { total: 0 }
);
```

## 6. Control flow

### `Index` is gone

```tsx
// 1.9
<Index each={items()}>
  {(item, i) => <Row item={item()} index={i} />}
</Index>

// 2.0
<For each={items()} keyed={false}>
  {(item, i) => <Row item={item()} index={i} />}
</For>
```

Callback shapes:

| Form | Callback | Index |
| --- | --- | --- |
| `<For each={list()}>` | `(item, i)` | accessor |
| `<For each={list()} keyed={false}>` | `(item, i)` | plain number |
| `<For each={list()} keyed={(item) => item.id}>` | `(item, i)` | accessors |

Use a literal `keyed` value. A dynamic boolean makes the callback shape ambiguous.

### `Suspense`, `ErrorBoundary`, `SuspenseList`

| 1.9 | 2.0 |
| --- | --- |
| `<Suspense fallback>` | `<Loading fallback>` |
| `<ErrorBoundary fallback>` | `<Errored fallback>` |
| `<SuspenseList revealOrder>` | `<Reveal order>` |

`Errored` passes an error accessor, not an error value:

```tsx
<Errored fallback={(err, reset) => (
  <div>
    <p>{err().message}</p>
    <button onClick={reset}>Retry</button>
  </div>
)}>
  <Profile />
</Errored>
```

`Reveal` takes `order="sequential" | "together" | "natural"` and a `collapsed` boolean that applies only to `"sequential"`.

### Dynamic components

```tsx
// 1.9
<Dynamic component={isEditing() ? Editor : Viewer} value={value()} />

// 2.0
const Active = dynamic(() => (isEditing() ? Editor : Viewer));
return <Active value={value()} />;
```

Hoist the factory to the component body, or to module scope for a constant tag. `<Dynamic>` still works, but Solid deprecates it.

## 7. DOM

### Event names

CamelCase only. A lowercase `on*` name is an attribute in 2.0.

```tsx
// 1.9: bound an event
<button onclick={increment} />

// 2.0: sets the onclick attribute and stringifies the function
<button onclick={increment} />

// 2.0
<button onClick={increment} />
```

`on:`, `oncapture:`, `attr:`, `bool:`, `use:`, and `classList` are compile errors on a native element. The error names the replacement.

### `classList`

```tsx
// 1.9
<div class="card" classList={{ active: isActive() }} />

// 2.0
<div class={["card", { active: isActive() }]} />
```

### Refs

A ref callback has no owner in 2.0. `getOwner()` returns `null` inside it, so `onCleanup` registered there does not work.

```tsx
// 2.0: owned lifecycle, unowned ref
let el;
onSettled(() => {
  el.addEventListener("pointerdown", onDown);
  return () => el.removeEventListener("pointerdown", onDown);
});

<div ref={el} />;
```

For a reusable behavior, use a directive factory. Its setup half has an owner and its apply half is the unowned ref.

```tsx
function tooltip(options) {
  let el;
  const instance = createTooltipInstance();
  createEffect(() => options.content, (content) => el && instance.setContent(content));
  onCleanup(() => instance.destroy());
  return (nextEl) => {
    el = nextEl;
    instance.attach(nextEl);
  };
}

<button ref={tooltip({ content: "Save" })} />;
```

Array refs run in order: `<button ref={[autofocus, tooltip(...)]} />`.

### `/*@once*/`

Solid 2.0 removes the marker. Keep the read reactive, use the platform default prop, or call `untrack` in JavaScript outside JSX.

```tsx
// 1.9
<input value={/*@once*/ props.initialValue} />

// 2.0
<input defaultValue={props.initialValue} />
```

## 8. Async data and mutations

### `createResource`

`createResource` is removed. Use an async memo for an object, an async derived store for a collection, and a `Loading` boundary for the fallback.

```ts
// 1.9
const [user] = createResource(id, fetchUser);

// 2.0
const user = createMemo(() => fetchUser(id()));
```

```tsx
<Loading fallback={<Spinner />}>
  <Profile user={user()} />
</Loading>
```

| 1.9 resource feature | 2.0 |
| --- | --- |
| `resource.loading` (initial) | `Loading` |
| `resource.loading` (refetch) | `isPending(() => resource())` |
| `resource.error` | `Errored` |
| `refetch()` | `refresh(resource)` |
| `mutate()` | `createOptimisticStore` plus `action` |

A bare `refresh()` is silent for `isPending`. Declare the dependency with `affects(resource)` or set an explicit optimistic flag.

### Transitions

`startTransition` and `useTransition` are removed. Transitions are built in. Use `isPending`, `latest`, and the optimistic primitives.

```ts
const pending = () => isPending(() => search());
const shown = () => latest(query);
```

### Mutations

```ts
const [todos] = createStore(() => api.getTodos(), { list: [] });
const [optimistic, setOptimistic] = createOptimisticStore({ list: [] });

const addTodo = action(function* (todo) {
  setOptimistic((s) => { s.list.push(todo); });
  yield api.addTodo(todo);
  refresh(todos);
});
```

Every draft write uses a block body. `setOptimistic((s) => s.list.push(todo))` returns a number and can replace the store root.

## 9. Context

```tsx
// 1.9
<Theme.Provider value="dark">{props.children}</Theme.Provider>

// 2.0
<Theme value="dark">{props.children}</Theme>
```

`createContext<T>()` without a default is typed `Context<T>`. `useContext` returns `T` and throws `ContextNotFoundError` when no provider is mounted. Remove wrapper hooks that existed only to narrow `T | undefined`.

`undefined` is never a context value. For an optional context, use `null` as the explicit empty value.

## 10. TypeScript

| 1.9 | 2.0 |
| --- | --- |
| `import type { JSX } from "solid-js"` | `import type { JSX } from "@solidjs/web"` |
| `JSX.Element` in renderer-neutral code | `Element` from `solid-js` |
| `SetStoreFunction` | `StoreSetter` |
| `equalFn` | `isEqual` |
| `getListener` | `getObserver` |

Function children and `For keyed={false}` change callback types. A `For` with `keyed={false}` gives `item: Accessor<T>` and `i: number`. See `references/typescript.md`.

## 11. Verification

Run these in order.

1. `tsc --noEmit`. Fix types before runtime behavior.
2. The existing unit tests. Add `flush()` or `await` where a test reads immediately after a setter.
3. The existing browser tests. Event names, list keying, and refs are the common breaks.
4. A production build. The compiler rejects removed JSX forms.
5. SSR: load each route and read the console for `Hydration structure mismatch`, `Hydration key miss`, and unclaimed nodes.
6. A memory check: mount and unmount a route repeatedly and confirm the effect count does not grow.
7. A dependency audit: confirm every Solid UI library resolves to a v2-compatible release.

## What not to automate

- Do not codemod `createEffect` by adding an empty apply function. That preserves the 1.x bug where a write happened during tracking.
- Do not codemod `createResource` to `createMemo` without placing a `Loading` boundary. An async read without a boundary blocks the shell.
- Do not codemod store path setters to a draft arrow with an expression body. It returns a value.
- Do not codemod `Index` to `For` without `keyed={false}`. The callback shape changes.
- Do not rename `onMount` to `onSettled` where the callback writes to a signal during setup.
  `onSettled` runs after render settles, and a write there is fine.
  A read of the written value during the same render is not.

## Rollback

Keep the 1.9 branch until the v2 app passes production checks. The two apps can share domain code and tests. They cannot share a lockfile, a build config, or a component that uses a changed runtime API.
