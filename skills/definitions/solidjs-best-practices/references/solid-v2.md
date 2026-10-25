# Solid 2.0 (release candidate)

`solid-js@2.0.0-rc.18` at the time of writing. This is a **release candidate**, not the stable line. This file is the API you may use when the version gate reports `mode: solid-2`. Every claim here is version-tagged; do not use it for 1.9.

## Project shape

```json
{
  "compilerOptions": {
    "jsx": "preserve",
    "jsxImportSource": "@solidjs/web",
    "moduleResolution": "bundler",
    "strict": true
  }
}
```

```ts
// vite.config.ts
import { defineConfig } from "vite";
import solid from "@solidjs/vite-plugin";

export default defineConfig({ plugins: [solid()] });
```

```ts
import {
  createSignal,
  createMemo,
  createEffect,
  createStore,
  createProjection,
  createOptimisticStore,
  action,
  refresh,
  affects,
  isPending,
  latest,
  until,
  reconcile,
  snapshot,
  merge,
  omit,
  flush,
  untrack,
  onSettled,
  onCleanup,
  createContext,
  useContext,
  children,
  Show,
  For,
  Repeat,
  Switch,
  Match,
  Loading,
  Errored,
  Reveal,
  lazy,
} from "solid-js";

import { render, hydrate, Portal, dynamic, isServer } from "@solidjs/web";
```

`solid-js/store` is gone; the store APIs are exported from `solid-js`. `solid-js/web` is gone; DOM APIs are in `@solidjs/web`. `solid-js` no longer ships a JSX runtime.

## Signals and memos

```tsx
const [count, setCount] = createSignal(0);
const doubled = createMemo(() => count() * 2);

setCount(1);
count();   // still 0 until the microtask batch flushes
flush();
count();   // 1
```

- **Reads lag writes.** Updates are batched per microtask. A read after a setter returns the last committed value until the batch lands or `flush()` forces it. Tests call `flush()` before asserting. Production code rarely should.
- **The updater receives staged writes.** `setCount((current) => current + 1)` is the safe form when the new value depends on the old one.
- **`createSignal(fn)` is a writable derived value.** It tracks `fn` and exposes a setter; use it for a local override of a prop.
- **`createMemo(fn)` may be async.** A Promise or async iterable result reads as pending; consumers under `<Loading>` see the fallback.
- **Memos do not write.** A write inside a memo (or an effect compute, or a component body) throws in development. Use a function-form signal or an action.
- **Options:** `equals`, `lazy` (defer first compute, dispose when unobserved), `unobserved`, `ssrSource`.

```tsx
const [value, setValue] = createSignal(() => props.initial);

const active = createMemo(() => users().filter((user) => user.active));
const total = createMemo(() => active().reduce((sum, user) => sum + user.score, 0), {
  equals: (a, b) => a === b,
});
```

## Effects

`createEffect` has two phases. The compute function tracks; the apply function runs untracked after the flush and may return cleanup.

```tsx
createEffect(
  () => userId(),
  (id) => {
    const controller = new AbortController();
    fetch(`/api/users/${id}`, { signal: controller.signal }).then(render);
    return () => controller.abort();
  }
);
```

- **Reactive reads belong in compute.** A read in apply does not re-trigger the effect.
- **Apply runs on every compute re-run.** Effects do not compare values. To skip unchanged values, read a memo in compute; the memo's `equals` stops propagation.
- **Cleanup runs before the next apply and on disposal.** Return it from apply.
- **`defer: true`** skips the first apply.
- **`EffectBundle`** handles errors from either phase:

```tsx
createEffect(
  () => fetchData(id()),
  {
    effect: (data) => render(data),
    error: (error) => report(error),
  }
);
```

- **`createTrackedEffect`** is the single-phase escape hatch. Prefer the split form; the tracked form re-subscribes from the apply body and is easier to get wrong.

`onSettled` replaces `onMount` and can return cleanup. It runs once after the first reactive settle, in an owned scope:

```tsx
onSettled(() => {
  const id = setInterval(tick, 1000);
  return () => clearInterval(id);
});
```

`onCleanup` still exists, but the guidance is to return cleanup from the apply function or `onSettled` instead of registering it imperatively. Use `onCleanup` when you are authoring a primitive or a directive factory and need the owner directly.

## Stores

The setter is draft-first. Mutate the draft. The callback may return a new value for shapes where mutation is awkward.

```tsx
const [state, setState] = createStore({
  user: { name: "Ada", address: { city: "London" } },
  todos: [] as Array<{ id: string; done: boolean; text: string }>,
});

setState((draft) => {
  draft.user.name = "Grace";
  draft.todos.push({ id: "1", done: false, text: "Write" });
});

setState((draft) => draft.todos.filter((todo) => !todo.done));
```

- The callback **must not return a value accidentally.** `setState((draft) => draft.todos.push(todo))` returns a number and can replace the store root. Use a block body for mutations.
- Arrays returned from the callback replace by index and adjust length. Objects are shallow-diffed at the top level.
- The setter does **not** do keyed reconciliation. Use `reconcile` or `createProjection`.
- `reconcile(value, key?)` returns an updater:

```tsx
setState((draft) => {
  reconcile(serverTodos, "id")(draft.todos);
});
```

- `snapshot(store)` returns a plain, non-reactive copy. `unwrap` is gone.
- `merge` replaces `mergeProps`; `omit` replaces `splitProps`. `undefined` is a real value in `merge` and overrides.

```tsx
const merged = merge({ a: 1, b: 2 }, { b: undefined }); // merged.b is undefined
const rest = omit(props, "class", "style");
```

- `createStore(fn, seed)` is a writable derived store:

```tsx
const [cache, setCache] = createStore(
  (draft) => {
    draft.total = items().length;
  },
  { total: 0 }
);
```

## Derived stores, projections, and optimistic state

`createProjection` is `createMemo` for stores. It reconciles the result by `key` (default `"id"`), so surviving rows keep their proxy identity.

```tsx
const summary = createProjection<{ total: number; active: number }>(
  (draft) => {
    draft.total = users().length;
    draft.active = users().filter((user) => user.active).length;
  },
  { total: 0, active: 0 }
);

const activeUsers = createProjection<User[]>(
  () => allUsers().filter((user) => user.active),
  []
);
```

There is no setter. Change the inputs. Use `createMemo` for a simple read-only derivation. Use a projection when the result is a collection that should keep row identity.

`createOptimisticStore` is a store whose writes inside an `action` are tentative and revert or reconcile when the action settles:

```tsx
const [todos, setTodos] = createOptimisticStore<Todo[]>([]);

const addTodo = action(function* (text: string) {
  const tempId = crypto.randomUUID();
  setTodos((draft) => {
    draft.push({ id: tempId, text, pending: true });
  });

  const saved = yield api.createTodo(text);

  setTodos((draft) => {
    const index = draft.findIndex((todo) => todo.id === tempId);
    if (index >= 0) draft[index] = saved;
  });
});
```

`action` wraps a generator. Each `yield` is a transaction-safe suspension point; writes between yields commit together. A plain `await` is outside the transaction, so put a bare `yield` before any write or reader creation that follows it.

```tsx
const saved = await api.createTodo(text);
yield; // re-enter the transaction
setTodos((draft) => { ... });
yield until(() => todos.some((todo) => todo.id === saved.id), { timeout: 5000 });
```

## Async UI

An async `createMemo` or `createStore(fn)` replaces `createResource`. `<Loading>` owns the first-ready fallback. `isPending` owns the in-flight indicator.

```tsx
const user = createMemo(() => fetchUser(userId()));

<Loading fallback={<Spinner />}>
  <Profile user={user()} />
</Loading>
```

- **`Loading`** catches a pending read in its subtree and renders `fallback` until every pending read resolves. After the first render, a refetch keeps content visible; `isPending` reports it.
- **`Loading on={expr}`** re-arms the boundary when anything `expr` reads changes. Use it when the route or id changes and stale content must not stay visible.
- **`Errored`** catches errors; `fallback` receives an error accessor and `reset`:

```tsx
<Errored fallback={(error, reset) => (
  <div>
    <p>{error().message}</p>
    <button onClick={reset}>Retry</button>
  </div>
)}>
  <Profile />
</Errored>
```

- **`Reveal`** coordinates sibling `Loading` boundaries. `order="sequential"` (default), `"together"`, or `"natural"`; `collapsed` is sequential-only.
- **`isPending(() => expr)`** is true while a change to `expr` is in flight. A bare `refresh()` is silent; call `affects(target)` before it if the refresh should read as pending.
- **`latest(expr)`** peeks at the in-flight value during a transition.
- **`until(predicate, { timeout, signal })`** resolves when a reactive predicate settles truthy. Yield it inside an action to hold the transaction open until confirmation.
- **`refresh(target)`** re-asks a derived read after a server write. It returns a promise for the next quiescent state; ignoring it is fire-and-forget.

## Control flow

```tsx
<Show when={user()} fallback={<Login />}>
  {(current) => <Profile user={current()} />}
</Show>

<For each={todos()} fallback={<p>Nothing to do.</p>}>
  {(todo, index) => <li>#{index()} {todo.text}</li>}
</For>

<For each={rows()} keyed={false}>
  {(row, index) => <Row value={row()} index={index} />}
</For>

<Repeat count={skeletons()}>
  {(index) => <SkeletonRow index={index} />}
</Repeat>

<Switch fallback={<NotFound />}>
  <Match when={route() === "home"}><Home /></Match>
  <Match when={route() === "settings"}><Settings /></Match>
</Switch>
```

- **`<For>` default** receives the raw item and an index accessor: `(item, i)`.
- **`<For keyed={false}>`** receives an item accessor and a plain number: `(item, i)`. This is the `Index` replacement. `i` is **not** a function.
- **`<For keyed={(item) => item.id}>`** receives item and index accessors: `(item, i)`.
- Prefer a literal `keyed` mode. A dynamic boolean makes the callback shape ambiguous.
- **`<Repeat>`** is for count/range rendering without diffing: skeletons, windowing.
- **`<Show>`/`<Match>` function children receive accessors**, so the narrowed value is safe to read.
- **`dynamic(source)`** replaces `createDynamic` and the `<Dynamic>` wrapper. Hoist the factory to the component body or module:

```tsx
import { dynamic } from "@solidjs/web";

const Active = dynamic(() => (isEditing() ? Editor : Viewer));
return <Active value={value()} />;
```

## Context

The context object is the provider. `Context.Provider` is gone.

```tsx
const Theme = createContext<"light" | "dark">("light");

<Theme value="dark">
  <Toolbar />
</Theme>
```

A default-less `createContext<T>()` has type `Context<T>`. `useContext` returns `T` and throws `ContextNotFoundError` if no provider mounts. Drop the `useX` wrapper that existed only to narrow `T | undefined`.

`undefined` is never a context value. Use `null` for an explicit empty value:

```tsx
const Optional = createContext<Config | null>(null);
```

## DOM

Solid 2.0 is closer to the platform:

- Built-in attributes are attributes, generally lowercase: `tabindex`, not `tabIndex`.
- Boolean attributes are presence/absence: `<video muted={true} />`.
- Event handlers are camelCase. Lowercase `on*` is an HTML attribute, not a Solid listener. `<button onclick={fn}>` stringifies the function in 2.0. Use `onClick`.
- `on:`, `oncapture:`, `attr:`, `bool:`, `use:`, and `classList` on a native element are compile errors. The message names the replacement.
- `class` accepts a string, an array, or an object:

```tsx
<div class={["card", { active: isActive(), disabled: isDisabled() }]} />
```

- Refs are callbacks and have no owner. `getOwner()` returns `null` inside. Do lifecycle work in `onSettled` or in a directive factory's setup half:

```tsx
let el: HTMLButtonElement | undefined;

onSettled(() => {
  el?.addEventListener("pointerdown", onDown);
  return () => el?.removeEventListener("pointerdown", onDown);
});

<button ref={el} />;
```

- A directive factory has an owned setup phase and an unowned apply callback:

```tsx
function tooltip(options: { content: () => string }) {
  let el: HTMLElement | undefined;
  const instance = createTooltipInstance();
  createEffect(options.content, (content) => el && instance.setContent(content));
  onCleanup(() => instance.destroy());

  return (next: HTMLElement) => {
    el = next;
    instance.attach(next);
  };
}

<button ref={tooltip({ content: () => props.label })} />;
```

- `clientOnly(() => import("./Widget"), { lazy?: true })` renders only in the browser and never server-renders. It is exported from `@solidjs/web`.
- `httpStatus(code, text?)` and `httpHeader(name, value, { append? })` declare SSR response metadata from a reactive scope. They are no-ops on the client.

## SSR

```tsx
import { renderToString, renderToStream, HydrationScript, isServer } from "@solidjs/web";
```

- `renderToStream(...).readable` returns a `ReadableStream<Uint8Array>` for a `Response` body.
- `ssrSource: "server" | "hybrid" | "client"` is a per-primitive hydration policy on memos, function-form signals/stores, projections, and effects.
- `deferStream: true` holds the stream flush until the primitive's first value resolves.
- `HydrationScript` is still the document-head script.
- `isServer` is still the compile-time branch.
- A browser global at module scope still crashes the server render.
  `clientOnly` is for a component that must not server-render.
  `onSettled` is for a browser API that can wait.

## SolidStart

`@solidjs/start@2.1.0` is stable and runs **Solid 1.9**, not Solid 2.0. If the project has Solid 2 core, SolidStart is not the framework layer; see `ssr-and-solidstart.md`. Do not import `@solidjs/start` APIs into a Solid 2 core example and call it supported.

## Version-specific traps

- **One-argument `createEffect` is an error.** Split it.
- **Reads lag writes.** A test that asserts immediately after a click fails until `flush()`.
- **Effects never compare.** Use a memo in compute to stop unchanged values.
- **Do not write in a memo, an effect compute, or a component body.** Development throws.
- **Do not read a reactive value at the top of a component body.** Read in JSX, a memo, or `untrack`. Flow callbacks are owners, not tracking scopes; read their accessor arguments in JSX.
- **`<For keyed={false}>` gives an item accessor and a number.** `i()` is wrong there.
- **The draft setter's return value matters.** A block body is the safe shape.
- **`onMount` is gone.** `onSettled` returns cleanup.
- **`createResource` is gone.** Async memos and `Loading` replace it.
- **`batch` is gone.** Batching is the default; `flush()` forces sync.
- **`Suspense`/`ErrorBoundary` are gone.** `Loading`/`Errored` replace them.
- **`Index` is gone.** `<For keyed={false}>` replaces it.
- **`solid-js/store` and `solid-js/web` are gone.** `solid-js` and `@solidjs/web`.
- **`classList`, `use:`, `on:`, `attr:`, `bool:` are gone.** `class`, ref factories, camelCase events, plain attributes.
- **Context.Provider is gone.** The context object is the provider.
- **A ref callback has no owner.** `onCleanup` inside it does nothing.
