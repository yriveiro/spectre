# Anti-pattern catalogue

Each entry names the versions it applies to, shows the wrong shape, says why it breaks, and shows the corrected shape. The `Audit rule` line matches a finding from `tools.spectre.solidjs({ action: "audit" })`, so a report and this file speak the same names.

Version tags: **1.9** means `solid-js@1.9.x`, **2.0** means `solid-js@2.0.0-rc.x`, **Start 1** means `@solidjs/start@1.x`, **Start 2** means `@solidjs/start@2.x` running on Solid 1.9.

## React habits

### AP-01 · Importing React

**Versions:** 1.9, 2.0 · **Audit rule:** `react-import`

```tsx
// wrong
import { useState } from "react";
```

**Why it breaks.** Solid has no React runtime. A React import either fails to resolve or pulls a second component model into the bundle. The two runtimes do not share state, scheduling, or JSX.

```tsx
// right
import { createSignal } from "solid-js";
```

**Source.** `docs.solidjs.com/concepts/intro-to-reactivity`.

### AP-02 · React hooks by name

**Versions:** 1.9, 2.0 · **Audit rule:** `react-hook`

```tsx
// wrong
const [count, setCount] = useState(0);
useEffect(() => { document.title = `${count}`; }, [count]);
```

**Why it breaks.** `useState` does not exist. `useEffect` has no dependency array in Solid and no re-run rule. An effect runs when the values it reads change, and it reads them by calling them.

```tsx
// right
const [count, setCount] = createSignal(0);
createEffect(() => count(), (value) => { document.title = `${value}`; });
```

**Source.** `docs.solidjs.com/concepts/effects`, `MIGRATION.md § Effects`.

### AP-03 · React DOM prop names

**Versions:** 1.9, 2.0 · **Audit rule:** `react-prop`

```tsx
// wrong
<label className="field" htmlFor="email" />
```

**Why it breaks.** Solid writes the platform attribute. `className` and `htmlFor` are not aliases, so the element gets attributes the browser ignores and the label is not associated with the input.

```tsx
// right
<label class="field" for="email" />
```

**Source.** `docs.solidjs.com/reference/jsx-attributes/classlist`, `docs.solidjs.com/reference/jsx-attributes/attr`.

### AP-04 · A React `key` prop

**Versions:** 1.9, 2.0 · **Audit rule:** `react-key`

```tsx
// wrong
<For each={items()}>{(item) => <Row key={item.id} item={item} />}</For>
```

**Why it breaks.** Solid has no `key` prop. `<For>` keys by item identity. In 2.0 the keying mode is the `keyed` prop on `<For>`, and a `key` on the child is just an unknown prop.

```tsx
// right, 1.9
<For each={items()}>{(item) => <Row item={item} />}</For>

// right, 2.0: explicit key function
<For each={items()} keyed={(item) => item.id}>{(item) => <Row item={item()} />}</For>
```

**Source.** `MIGRATION.md § List rendering`, `docs.solidjs.com/reference/components/for`.

### AP-05 · `.map()` into JSX

**Versions:** 1.9, 2.0 · **Audit rule:** `react-map`

```tsx
// wrong
<ul>{items().map((item) => <li>{item.name}</li>)}</ul>
```

**Why it breaks.** The whole array is re-created when the signal changes. Solid cannot reconcile rows, so every DOM node is replaced and every row loses focus and local state. React needs `key` to avoid this. Solid needs `<For>`.

```tsx
// right
<ul><For each={items()}>{(item) => <li>{item.name}</li>}</For></ul>
```

**Source.** `docs.solidjs.com/concepts/control-flow/list-rendering`.

### AP-06 · Destructuring props

**Versions:** 1.9, 2.0 · **Audit rule:** `props-destructured`

```tsx
// wrong
function Greeting({ name }: { name: string }) {
  return <h1>Hello, {name}</h1>;
}
```

**Why it breaks.** Props are getters. Destructuring reads each one once during setup, so a later prop change never reaches the JSX. In 2.0 development also reports a top-level reactive read.

```tsx
// right
function Greeting(props: { name: string }) {
  return <h1>Hello, {props.name}</h1>;
}
```

**Source.** `docs.solidjs.com/concepts/components/props`, `MIGRATION.md § Dev warnings`.

## Reactivity

### AP-07 · Reading a reactive value once and rendering the copy

**Versions:** 1.9, 2.0

```tsx
// wrong
function Counter() {
  const [count, setCount] = createSignal(0);
  const value = count();
  return <button onClick={() => setCount(count() + 1)}>{value}</button>;
}
```

**Why it breaks.** `count()` runs during setup. The button shows the first value forever. The read must sit in JSX or in a reactive scope.

```tsx
// right
return <button onClick={() => setCount(count() + 1)}>{count()}</button>;
```

**Source.** `docs.solidjs.com/concepts/signals`, `v2.solidjs.com/concepts/reactivity`.

### AP-08 · An effect that derives state

**Versions:** 1.9, 2.0 · **Audit rule:** `v2-api-in-v1` when it writes in 2.0

```tsx
// wrong
const [doubled, setDoubled] = createSignal(0);
createEffect(() => setDoubled(count() * 2));
```

**Why it breaks.** The value is a pure function of `count`. An effect adds a second render pass, a transient wrong value, and a write that 2.0 rejects inside a tracked scope. A memo has none of those.

```tsx
// right
const doubled = createMemo(() => count() * 2);
```

**Source.** `v2.solidjs.com/guides/avoid-unnecessary-effects`, `MIGRATION.md § Write inside reactive scope`.

### AP-09 · An effect that writes its own source

**Versions:** 1.9, 2.0 · **Audit rule:** none, runtime diagnostic `EFFECT_WRITES_OWN_SOURCE`

```tsx
// wrong
createEffect(() => {
  if (page() > max()) setPage(max());
});
```

**Why it breaks.** The effect reads `page`, writes `page`, and runs again. 1.9 loops or settles after an extra pass. 2.0 reports `[EFFECT_WRITES_OWN_SOURCE]`, and the flush settles in two passes with the pre-write value painted in between.

```tsx
// right: clamp where the value is derived or written
const page = createMemo(() => Math.min(rawPage(), max()));
```

**Source.** `v2.solidjs.com/reference/solid-js/diagnostics/effect-writes-own-source`.

### AP-10 · An async effect callback

**Versions:** 1.9, 2.0 · **Audit rule:** `effect-async`

```tsx
// wrong
createEffect(async () => {
  const res = await fetch(url());
  setData(await res.json());
});
```

**Why it breaks.** In 1.9 the tracking context ends at the first `await`, so `url()` is the only dependency and anything read later is untracked. The returned Promise is not a cleanup function. In 2.0 the apply function must return a cleanup or nothing, and `onSettled` cannot suspend on a pending async read.

```tsx
// right, 2.0: async compute, sync apply
const data = createMemo(() => fetchJson(url()));

createEffect(
  () => data(),
  (value) => { render(value); }
);
```

```tsx
// right, 1.9: createResource owns the request
const [data] = createResource(url, fetchJson);
```

**Source.** `v2.solidjs.com/reference/solid-js/reactivity/create-effect`, `v2.solidjs.com/reference/solid-js/diagnostics/pending-async-forbidden-scope`.

### AP-11 · A one-argument `createEffect` in 2.0

**Versions:** 2.0 · **Audit rule:** `v2-effect-arity`

```tsx
// wrong
createEffect(() => {
  document.title = count();
});
```

**Why it breaks.** The one-argument form is the Solid 1.9 contract: dependencies are read and the side effect runs in the same tracked callback. In 2.0 `createEffect` takes two functions: compute declares the dependencies and returns the value, apply performs the side effect and returns the cleanup. A one-argument call does not typecheck, and in plain JavaScript it leaves the apply phase undefined.

```tsx
// right
createEffect(
  () => count(),
  (value) => { document.title = String(value); }
);
```

**Source.** `v2.solidjs.com/reference/solid-js/reactivity/create-effect`, `MIGRATION.md § Effects`.

### AP-12 · No cleanup for a subscription

**Versions:** 1.9, 2.0

```tsx
// wrong
onMount(() => {
  window.addEventListener("resize", onResize);
});
```

**Why it breaks.** Every mount adds a listener and no unmount removes it. The component, its closure, and its signals stay alive.

```tsx
// right, 1.9
onMount(() => {
  window.addEventListener("resize", onResize);
  onCleanup(() => window.removeEventListener("resize", onResize));
});

// right, 2.0
onSettled(() => {
  window.addEventListener("resize", onResize);
  return () => window.removeEventListener("resize", onResize);
});
```

**Source.** `docs.solidjs.com/reference/lifecycle/on-cleanup`, `MIGRATION.md § Effects`.

### AP-13 · An async response that outruns a newer one

**Versions:** 1.9, 2.0

```tsx
// wrong
createEffect(() => {
  const id = params.id;
  fetch(`/api/post/${id}`).then((r) => r.json()).then(setPost);
});
```

**Why it breaks.** Two navigations start two requests. The slower first response can land last and overwrite the newer post. Solid does not order promises for you.

```tsx
// right: abort the previous request
createEffect(
  () => params.id,
  (id) => {
    const controller = new AbortController();
    fetch(`/api/post/${id}`, { signal: controller.signal })
      .then((r) => r.json())
      .then(setPost)
      .catch((error) => { if (error.name !== "AbortError") throw error; });
    return () => controller.abort();
  }
);
```

**Source.** `docs.solidjs.com/advanced-concepts/fine-grained-reactivity`, `v2.solidjs.com/guides/custom-primitives`.

### AP-14 · `untrack` used to silence a real dependency

**Versions:** 1.9, 2.0

```tsx
// wrong
const label = createMemo(() => untrack(() => props.label));
```

**Why it breaks.** `untrack` is for a read that must not subscribe. Here the label should update, so the memo freezes the first value. The same mistake in JSX hides a dependency that the UI needs.

```tsx
// right
const label = createMemo(() => props.label);
```

**Source.** `docs.solidjs.com/reference/reactive-utilities/untrack`.

## Stores

### AP-15 · Destructuring a store

**Versions:** 1.9, 2.0

```tsx
// wrong
const { user, todos } = store;
```

**Why it breaks.** The read happens once. Replacing `store.user` does not update the binding, and the component stops tracking that path. A nested object can still be a proxy, which makes the bug intermittent.

```tsx
// right
const user = () => store.user;
const todos = () => store.todos;
```

**Source.** `docs.solidjs.com/concepts/stores`.

### AP-16 · A path-string store setter in 2.0

**Versions:** 2.0 · **Audit rule:** `v2-store-path-setter`

```tsx
// wrong
setStore("user", "name", "Ada");
```

**Why it breaks.** Path setters are removed in 2.0. The call compiles only if an unrelated overload catches it, and it does not perform the draft update the rest of the app expects.

```tsx
// right
setStore((s) => { s.user.name = "Ada"; });
```

**Source.** `MIGRATION.md § Draft-first setters`.

### AP-17 · A draft setter with an expression body

**Versions:** 2.0 · **Audit rule:** `v2-draft-return`

```tsx
// wrong
setStore((s) => s.items.push(item));
```

**Why it breaks.** `push` returns the new length. The callback returns a number, and the setter can treat that return as the new root. The list becomes a number and the next read throws.

```tsx
// right
setStore((s) => { s.items.push(item); });
```

**Source.** `MIGRATION.md § Draft-first setters`.

### AP-18 · Replacing a store root with a spread copy

**Versions:** 1.9, 2.0

```tsx
// wrong
setStore({ ...store, count: store.count + 1 });
```

**Why it breaks.** The spread reads every property into a plain object and replaces the root. Every row loses identity, every memo depending on an untouched branch re-runs, and nested proxies are rebuilt.

```tsx
// right
setStore((s) => { s.count++; });
// or, for a server payload
setStore(reconcile(next));
```

**Source.** `docs.solidjs.com/concepts/stores`, `docs.solidjs.com/reference/store-utilities/reconcile`.

### AP-19 · `unwrap` in 2.0 and `snapshot` in 1.9

**Versions:** 1.9, 2.0 · **Audit rule:** `v2-api-in-v1`

```tsx
// wrong, 2.0
const plain = unwrap(store);

// wrong, 1.9
const plain = snapshot(store);
```

**Why it breaks.** The names belong to different majors. The v1 call is undefined in 2.0 and the v2 call is undefined in 1.9.

```tsx
// right, 2.0
const plain = snapshot(store);

// right, 1.9
const plain = unwrap(store);
```

**Source.** `MIGRATION.md § unwrap → snapshot`.

## Control flow

### AP-20 · `Index` in 2.0, or the wrong `For` keying mode

**Versions:** 2.0 · **Audit rule:** `v1-api-in-v2`

```tsx
// wrong
<Index each={rows()}>{(row) => <Row row={row()} />}</Index>
```

**Why it breaks.** `Index` is removed. In 2.0, `For` has three keying modes and the callback shape changes with them. A dynamic `keyed` value makes the shape ambiguous at the type level and at runtime.

```tsx
// right: Index replacement
<For each={rows()} keyed={false}>{(row) => <Row row={row()} />}</For>

// right: stable identity by id
<For each={rows()} keyed={(row) => row.id}>{(row) => <Row row={row()} />}</For>
```

**Source.** `MIGRATION.md § List rendering`, `v2.solidjs.com/reference/solid-js/components-jsx/for`.

### AP-21 · A `Show` child that treats the accessor as a value

**Versions:** 1.9, 2.0

```tsx
// wrong
<Show when={user()}>{(user) => <Profile user={user} />}</Show>
```

**Why it breaks.** The callback receives an accessor, not the value. `Profile` gets a function where it expects a user, and reading the function later gives whatever the source holds at that moment.

```tsx
// right
<Show when={user()}>{(user) => <Profile user={user()} />}</Show>
```

**Source.** `docs.solidjs.com/reference/components/show`, `MIGRATION.md § Function children`.

## DOM and accessibility

### AP-22 · `classList` in 2.0

**Versions:** 2.0 · **Audit rule:** `v1-api-in-v2`

```tsx
// wrong
<div class="card" classList={{ active: isActive() }} />
```

**Why it breaks.** `classList` is a compile error on a native element in 2.0. The supported form is a `class` value that accepts a string, an object, or an array.

```tsx
// right
<div class={["card", { active: isActive() }]} />
```

**Source.** `MIGRATION.md § classList → class`.

### AP-23 · A lowercase `onclick` in 2.0

**Versions:** 2.0

```tsx
// wrong
<button onclick={increment} />
```

**Why it breaks.** In 2.0 a lowercase `on*` name is an attribute. The function is stringified into the `onclick` attribute and never runs as a Solid handler. Development warns `LOWERCASE_EVENT_ATTRIBUTE`.

```tsx
// right
<button onClick={increment} />
```

**Source.** `MIGRATION.md § Attributes & events`.

### AP-24 · Cleanup registered inside a ref callback in 2.0

**Versions:** 2.0

```tsx
// wrong
<div ref={(el) => {
  el.addEventListener("pointerdown", onDown);
  onCleanup(() => el.removeEventListener("pointerdown", onDown));
}} />
```

**Why it breaks.** A ref callback is unowned in 2.0. `getOwner()` is `null`, so `onCleanup` has no scope to attach to and the listener leaks.

```tsx
// right: lifecycle in an owned scope
let el;
onSettled(() => {
  el.addEventListener("pointerdown", onDown);
  return () => el.removeEventListener("pointerdown", onDown);
});

<div ref={el} />;
```

**Source.** `MIGRATION.md § Ref callbacks`.

### AP-25 · User data through `innerHTML`

**Versions:** 1.9, 2.0 · **Audit rule:** `xss-inner-html`

```tsx
// wrong
<div innerHTML={comment.body} />
```

**Why it breaks.** The value is parsed as HTML in the page origin. A comment containing a script or an event handler executes with the session's access. Solid escapes text in JSX and does not escape `innerHTML`.

```tsx
// right
<p>{comment.body}</p>
```

**Source.** `docs.solidjs.com/reference/jsx-attributes/innerhtml`.

### AP-26 · An image with no `alt`

**Versions:** 1.9, 2.0 · **Audit rule:** `a11y-img-alt`

```tsx
// wrong
<img src={product.image} />
```

**Why it breaks.** A screen reader announces the file name or nothing. The image has no accessible name.

```tsx
// right
<img src={product.image} alt={product.name} />
<img src={divider} alt="" />
```

**Source.** `docs.solidjs.com/concepts/components/basics`.

## SSR

### AP-27 · A browser global at module scope

**Versions:** all SSR stacks · **Audit rule:** `ssr-browser-global`

```tsx
// wrong
const saved = localStorage.getItem("cart");
```

**Why it breaks.** Module scope runs on the server, once per process. `localStorage` is undefined and the first request throws `ReferenceError`. If it does not throw, the value is shared by every request.

```tsx
// right
onSettled(() => {
  const saved = localStorage.getItem("cart");
  if (saved) hydrateCart(JSON.parse(saved));
});
```

**Source.** `v2.solidjs.com/guides/ssr-safe-code`, `docs.solidjs.com/reference/rendering/is-server`.

### AP-28 · `isServer` choosing different markup

**Versions:** all SSR stacks

```tsx
// wrong
{isServer ? <p>Server</p> : <time>{Date.now()}</time>}
```

**Why it breaks.** Hydration claims the server nodes by key and position. A different element on each side gives `Hydration tag mismatch`, and the client bindings attach to the wrong node.

```tsx
// right: same structure, browser value after hydration
const [now, setNow] = createSignal<number>();
onSettled(() => setNow(Date.now()));

<p>{now() ? `Rendered at ${now()}` : "Rendered on the server"}</p>
```

**Source.** `v2.solidjs.com/guides/ssr-safe-code#reading-the-hydration-warnings`.

### AP-29 · A per-run value in render

**Versions:** all SSR stacks · **Audit rule:** `ssr-nondeterministic`

```tsx
// wrong
<Show when={Math.random() < 0.5}>...</Show>
```

**Why it breaks.** The server and the browser roll independently. One renders a branch the other does not. The result is a key miss or an unclaimed server node.

```tsx
// right: decide once, on the server
<Show when={props.promo}>...</Show>
```

**Source.** `v2.solidjs.com/guides/ssr-safe-code#values-that-differ-on-every-run`.

## Async and data

### AP-30 · `createResource` in 2.0

**Versions:** 2.0 · **Audit rule:** `v1-api-in-v2`

```tsx
// wrong
const [user] = createResource(id, fetchUser);
```

**Why it breaks.** `createResource` is removed. The replacement is an async memo or an async derived store, read under a `Loading` boundary.

```tsx
// right
const user = createMemo(() => fetchUser(id()));

<Loading fallback={<Spinner />}>
  <Profile user={user()} />
</Loading>
```

**Source.** `MIGRATION.md § createResource → async computations`.

### AP-31 · Data fetching in an effect

**Versions:** 1.9, 2.0, all Start versions

```tsx
// wrong
createEffect(() => {
  fetch(`/api/products/${props.id}`).then((r) => r.json()).then(setProduct);
});
```

**Why it breaks.** The request starts after mount, so the server render never sees the data and the page ships a loading state. Navigations waterfall: render, effect, request, render. Nothing deduplicates the same read.

```tsx
// right, Start 2: route query plus preload
const getProduct = query(async (id: string) => {
  "use server";
  return db.products.get(id);
}, "product");

export const route = { preload: ({ params }) => getProduct(params.id) } satisfies RouteDefinition;
```

**Source.** `docs.solidjs.com/solid-start/v2/building-your-application/data-fetching`, `v2.solidjs.com/guides/data-fetching-patterns`.

## TypeScript

### AP-32 · `any` at a component boundary

**Versions:** 1.9, 2.0 · **Audit rule:** `type-any`

```tsx
// wrong
function Row(props: any) {
  return <td>{props.item.name}</td>;
}
```

**Why it breaks.** The prop shape, the store shape, and the callback shape stop being checked. The mistakes this catalogue describes, such as an accessor passed where a value is expected, become runtime errors.

```tsx
// right
function Row(props: { item: Item }) {
  return <td>{props.item.name}</td>;
}
```

**Source.** `v2.solidjs.com/guides/typescript`.

## SolidStart

### AP-33 · Solid 2 installed into SolidStart

**Versions:** Start 1, Start 2

```jsonc
// wrong
{
  "dependencies": {
    "@solidjs/start": "2.1.0",
    "solid-js": "2.0.0-rc.18"
  }
}
```

**Why it breaks.** Released SolidStart 2 peers on `solid-js ^1.9.15` and runs on Solid 1. It does not support Solid 2. The install either refuses or produces a runtime with two incompatible cores. Solid 2 start mode lives in `@solidjs/vite-plugin`, and it is not SolidStart.

```jsonc
// right: stable SolidStart
{ "@solidjs/start": "2.1.0", "solid-js": "1.9.17" }
```

**Source.** `v2.solidjs.com/migration/from-solid-start`, `@solidjs/start@2.1.0` package peer dependencies.

### AP-34 · A SolidStart 1 config or import inside SolidStart 2

**Versions:** Start 2

```ts
// wrong
import { defineConfig } from "@solidjs/start/config"; // app.config.ts
import { useSession } from "vinxi/http";
```

**Why it breaks.** Start 2 uses `vite.config.ts`, `solidStart()` from `@solidjs/start/config`, and `@solidjs/start/http`. Vinxi is removed. Keeping `app.config.ts` means the framework settings are never read.

```ts
// right
import { defineConfig } from "vite";
import { nitro } from "nitro/vite";
import { solidStart } from "@solidjs/start/config";
import { useSession } from "@solidjs/start/http";

export default defineConfig({ plugins: [solidStart(), nitro()] });
```

**Source.** `docs.solidjs.com/solid-start/v2/reference/entrypoints/vite-config`, `v2.solidjs.com/migration/from-solid-start`.

### AP-35 · `js` serialization under a strict CSP

**Versions:** Start 1 default, Start 2 opt-in

```ts
// wrong for a strict CSP
solidStart({ serialization: { mode: "js" } });
```

**Why it breaks.** `js` mode deserializes with `eval`, which a policy without `unsafe-eval` blocks. The page loads and server function payloads fail to deserialize.

```ts
// right
solidStart({ serialization: { mode: "json" } });
```

**Source.** `docs.solidjs.com/solid-start/v2/advanced/serialization`, `docs.solidjs.com/solid-start/v2/guides/security`.

### AP-36 · An incompatible dependency matrix

**Versions:** all · **Audit rule:** `version-mixing`

```jsonc
// wrong
{
  "@solidjs/start": "2.1.0",
  "solid-js": "2.0.0-rc.18",
  "@solidjs/router": "2.0.0-next.42"
}
```

**Why it breaks.** The packages do not share a line. Start 2 peers on Solid 1.9 and router `<2.0.0-0`; router 2 and `@solidjs/meta` 1 peer on Solid 2. Importing a 1.x-only name or rendering a removed tag into a Solid 2 tree is the same failure seen from source. The detector reports each conflict, and the audit turns each one into a `version-mixing` finding.

```jsonc
// right: stable Start 2
{
  "@solidjs/start": "2.1.0",
  "solid-js": "1.9.17",
  "@solidjs/router": "1.0.0"
}
```

**Source.** `references/version-gate.md`, and the published peer dependencies of `@solidjs/start@2.1.0`, `@solidjs/router@2.0.0-next.42`, and `@solidjs/meta@1.0.0-next.2`.
