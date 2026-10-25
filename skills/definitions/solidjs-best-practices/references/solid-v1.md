# Solid 1.9

Stable line. `solid-js@1.9.17` at the time of writing. This file is the API you may use when the version gate reports `mode: solid-1`. If it reports `solid-2`, close this file and open `solid-v2.md`. The two are not interchangeable.

## Project shape

```json
{
  "compilerOptions": {
    "jsx": "preserve",
    "jsxImportSource": "solid-js",
    "moduleResolution": "bundler",
    "strict": true
  }
}
```

```ts
// vite.config.ts
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({ plugins: [solid()] });
```

```ts
import {
  createSignal,
  createMemo,
  createEffect,
  createResource,
  createRoot,
  batch,
  untrack,
  on,
  onMount,
  onCleanup,
  createContext,
  useContext,
  children,
  mergeProps,
  splitProps,
  Show,
  For,
  Index,
  Switch,
  Match,
  Suspense,
  SuspenseList,
  ErrorBoundary,
  lazy,
} from "solid-js";

import { createStore, produce, reconcile, unwrap } from "solid-js/store";
import { render, hydrate, Portal, Dynamic, isServer } from "solid-js/web";
```

## Signals and memos

`createSignal` returns a getter and a setter. The getter is a function; forgetting the call is the most common "it does not update" bug.

```tsx
const [count, setCount] = createSignal(0);

count();                 // read
setCount(1);             // write a value
setCount((current) => current + 1); // write from the latest value

const doubled = createMemo(() => count() * 2);
```

- The setter is synchronous. A read after `setCount(1)` returns `1`. No microtask lag exists in 1.x.
- `createSignal(value, { equals })` controls equality. The default is `===`.
- A memo is lazy in the sense that it computes on first read, then caches until a dependency changes. It is also the right place to stop propagation when a derived value stays unchanged.
- A plain function is enough for a cheap derivation with one reader:

```tsx
const subtotal = () => items().reduce((sum, item) => sum + item.price, 0);
return <p>{subtotal()}</p>;
```

- Do not read a signal at the top level of a component and expect it to update. The component body runs once and is not a tracking scope.

## Effects

`createEffect` runs after render, tracks every reactive read in its callback, and re-runs when any of them change. It does not run before paint; use `createRenderEffect` only for renderer-level work.

```tsx
createEffect(() => {
  document.title = `${count()} clicks`;
});
```

The second argument is an initial value passed to the callback on the first run:

```tsx
createEffect((previous) => {
  console.log("was", previous, "now", count());
  return count();
}, 0);
```

`on` declares dependencies explicitly, which is useful when the callback reads something that should not be tracked:

```tsx
createEffect(on(count, (value, previous) => {
  console.log("changed", previous, "->", value);
}, { defer: true }));
```

`onMount` runs once after the component mounts and tracks nothing. It is the right place for a one-time browser API call:

```tsx
onMount(() => {
  const id = setInterval(() => setCount((value) => value + 1), 1000);
  onCleanup(() => clearInterval(id));
});
```

`onCleanup` registers teardown with the current owner. It works inside a component, an effect, a root, and a ref callback in 1.x.

```tsx
createEffect(() => {
  const controller = new AbortController();
  fetch(`/api/users/${userId()}`, { signal: controller.signal }).then(render);
  onCleanup(() => controller.abort());
});
```

Rules:

- An `async` callback returns a Promise that Solid does not await and cannot clean up. Track the input, start the request, and register an abort.
- A write inside an effect can re-trigger the effect. Derive instead, or guard the write with a condition that becomes false.
- Effects run in an unspecified order. Do not depend on one effect running before another.
- `createComputed` runs immediately and is for derived writes; prefer `createMemo` or `createEffect` unless you need that timing.

## Batching and untracking

`batch` defers downstream computation until the callback returns:

```tsx
batch(() => {
  setFirstName("Ada");
  setLastName("Lovelace");
});
```

Solid batches inside `createEffect`, `onMount`, and store setters automatically. `batch` applies only to writes before the first `await` in an async callback.

`untrack` reads without subscribing:

```tsx
createEffect(() => {
  const current = untrack(count);
  console.log("count changed; the initial value was", current);
});
```

Use it narrowly. If a value should stay live, `untrack` is the wrong tool.

## Props

Props are a reactive object. Read the property where you use it. Do not destructure it.

```tsx
type GreetingProps = { name: string; count: number };

function Greeting(props: GreetingProps) {
  return <p>Hello {props.name}, you have {props.count} messages.</p>;
}

// Parent
<Greeting name={user().name} count={messages().length} />
```

Why destructuring breaks:

```tsx
// Wrong: `name` is read once, in the component body, outside any tracking scope.
function Greeting({ name }: GreetingProps) {
  return <p>Hello {name}</p>;
}
```

Use `splitProps` to separate local props from the rest, and `mergeProps` to fill defaults:

```tsx
function Button(props: ButtonProps) {
  const [local, rest] = splitProps(props, ["variant", "children"]);
  const merged = mergeProps({ variant: "primary" }, local);
  return <button class={merged.variant} {...rest}>{merged.children}</button>;
}
```

Both return reactive proxy objects. Do not destructure their result either.

`children` resolves and memoizes a `children` prop so it can be read more than once:

```tsx
import { children, type JSX } from "solid-js";

function Card(props: { children: JSX.Element }) {
  const resolved = children(() => props.children);
  return <section>{resolved()}</section>;
}
```

## Context

```tsx
type Theme = "light" | "dark";
const ThemeContext = createContext<Theme>("light");

function App() {
  return (
    <ThemeContext.Provider value="dark">
      <Toolbar />
    </ThemeContext.Provider>
  );
}

function Toolbar() {
  const theme = useContext(ThemeContext); // Theme | undefined without a default
  return <div class={theme ?? "light"}>...</div>;
}
```

A context without a default has type `T | undefined` in 1.x. The common `useX` wrapper narrows it:

```tsx
function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (theme === undefined) throw new Error("ThemeContext is missing");
  return theme;
}
```

Keep reactive state in the context value, not in a snapshot of it. A provider that passes `value={state}` where `state` is a store is fine. A provider that passes `value={{ ...state }}` creates a new object on every render and loses identity.

## Stores

`createStore` gives fine-grained tracking over nested data. The setter takes a path, a value, or an updater.

```tsx
const [state, setState] = createStore({
  user: { name: "Ada", address: { city: "London" } },
  todos: [] as Array<{ id: string; done: boolean; text: string }>,
});

setState("user", "name", "Grace");
setState("todos", (todos) => [...todos, { id: "1", done: false, text: "Write" }]);
setState("todos", 0, "done", true);
```

- A property read tracks that property. Reading `state.user.name` does not subscribe to `state.todos`.
- Setting a property to `undefined` deletes it.
- Object updates shallow-merge by default. A single array update replaces the array contents.
- `produce` gives a mutable draft for a multi-step update:

```tsx
setState(produce((draft) => {
  draft.user.address.city = "Paris";
  draft.todos.push({ id: "2", done: false, text: "Review" });
}));
```

- `reconcile` merges server data into an existing store while preserving identity for unchanged rows:

```tsx
setState("todos", reconcile(nextTodos, { key: "id" }));
```

- `unwrap` returns the plain object behind the proxy. Use it at a boundary that cannot accept a proxy (structured clone, some third-party libraries), not as a general read.

```tsx
const plain = unwrap(state);
```

Do not mutate the store object directly (`state.user.name = "Grace"`). The setter is what notifies subscribers and keeps batching coherent.

## Control flow

```tsx
<Show when={user()} fallback={<Login />}>
  {(current) => <Profile user={current()} />}
</Show>

<For each={todos()} fallback={<p>Nothing to do.</p>}>
  {(todo, index) => (
    <li>
      #{index()} {todo.text}
    </li>
  )}
</For>

<Index each={rows()}>
  {(row, index) => <Row value={row()} index={index} />}
</Index>

<Switch fallback={<NotFound />}>
  <Match when={route() === "home"}><Home /></Match>
  <Match when={route() === "settings"}><Settings /></Match>
</Switch>
```

- `<For>` keys by item identity. If the same object moves, its DOM nodes move. Use it for lists of objects with stable identity.
- `<Index>` keys by index. The item is an accessor; the index is a number. Use it when the shape is stable and only values change (a table of cells, a fixed set of rows).
- `<Show>` passes an accessor to its function child, so the narrowed value is safe to read. A ternary or `&&` in JSX does not narrow and is easy to read wrong.
- `<Switch>`/`<Match>` is for mutually exclusive branches. `<Show>` is for one condition.
- `<Dynamic component={...}>` swaps a component at runtime. `<Portal>` mounts outside the parent DOM while keeping the reactive owner.

```tsx
<Dynamic component={isEditing() ? Editor : Viewer} value={value()} />
<Portal mount={document.body}><Toast /></Portal>
```

## Async

`createResource` ties an async read to a reactive source:

```tsx
const [user, { refetch, mutate }] = createResource(userId, async (id) => {
  const response = await fetch(`/api/users/${id}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<User>;
});

user();          // User | undefined
user.loading;    // boolean
user.error;      // unknown
user.state;      // "unresolved" | "pending" | "ready" | "refreshing" | "errored"
user.latest;     // the last value while a refetch is in flight
```

- Without a source, the fetcher receives `true` and runs once.
- `initialValue` makes the resource start in `ready` state and removes `undefined` from the type.
- `deferStream` holds the SSR stream until the resource resolves.
- `ssrLoadFrom: "initial"` refetches on the client after hydration; `"server"` is the default and reuses the server value.
- A resource that throws surfaces through `error`. Wrap the consumer in `<ErrorBoundary>` or branch on `user.error`.

For a mutation, call the API and update the resource deliberately:

```tsx
async function save(next: User) {
  const response = await fetch(`/api/users/${next.id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(next),
  });
  if (!response.ok) throw new Error("save failed");
  mutate(await response.json());
}
```

`createResource` is not a cache and does not deduplicate requests. If two components read the same key, lift the resource to their common owner or use the router's query cache in SolidStart.

## SSR

```tsx
import { renderToString, renderToStream, HydrationScript, isServer } from "solid-js/web";

const html = renderToString(() => <App />);
const stream = renderToStream(() => <App />);
```

- `isServer` is a compile-time constant. A branch on it is removed from the client bundle.
- `HydrationScript` emits the script that restores the reactive graph. It must be in the document head before the app script.
- `renderToString` and `renderToStream` are for a server entry. `hydrate` is for the client entry.
- A browser global read at module scope crashes the server render. Guard it or move it into `onMount`.
- A value that differs between server and client (`Date.now()`, `Math.random()`, `window.innerWidth`) produces a hydration mismatch. Compute it on the server and serialize it, or render it after mount.

```tsx
function Clock() {
  const [now, setNow] = createSignal<Date | undefined>();
  onMount(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    onCleanup(() => clearInterval(id));
  });
  return <time>{now()?.toISOString() ?? ""}</time>;
}
```

## SolidStart 1

A SolidStart 1 app adds Vinxi, Nitro 2, and `app.config.ts`:

```ts
// app.config.ts
import { defineConfig } from "@solidjs/start/config";

export default defineConfig({
  server: { preset: "node-server" },
});
```

```tsx
// src/app.tsx
import { Router } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import { Suspense } from "solid-js";

export default function App() {
  return (
    <Router root={(props) => <Suspense>{props.children}</Suspense>}>
      <FileRoutes />
    </Router>
  );
}
```

- Routes live in `src/routes`. A default-exported component is a page. A file named after a folder is a layout.
- Server functions use `"use server"` inside the function body.
- Data reads use `query` + `createAsync` from `@solidjs/router`, with `preload` on the route definition for single-flight mutations.
- HTTP helpers come from `vinxi/http` (`useSession`, `getRequestEvent`).
- `@solidjs/start/server` exports the server entry helpers; `@solidjs/start/client` exports `mount`.
- Streaming headers cannot be changed after the stream starts. Use `deferStream: true` for a query that sets cookies or redirects.

`ssr-and-solidstart.md` holds the full v1/v2 comparison and the migration steps.

## Version-specific traps

- **`createEffect` with one argument is correct here.** It is an error in 2.0, not in 1.9.
- **Store setters take paths here.** `setState("user", "name", "Grace")` is correct in 1.9 and removed in 2.0.
- **`solid-js/store` and `solid-js/web` are correct here.** They are removed subpaths in 2.0.
- **`Index` is correct here.** It is removed in 2.0 in favor of `<For keyed={false}>`.
- **`Suspense`, `SuspenseList`, and `ErrorBoundary` are correct here.** They are renamed in 2.0.
- **A context without a default returns `T | undefined` here.** In 2.0 it returns `T` and throws if unprovided.
- **`batch` is correct here.** In 2.0 batching is the default and `batch` is gone.
- **`mergeProps`/`splitProps`/`unwrap` are correct here.** They are `merge`/`omit`/`snapshot` in 2.0.
