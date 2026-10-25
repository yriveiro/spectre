# SSR, hydration and SolidStart

Server rendering crosses four different stacks that look alike and are not. Identify the stack before you change a line. The version gate in `references/version-gate.md` is still the first step.

## Which stack are you on

| Stack | Solid core | Build tool | Config file | Imports |
| --- | --- | --- | --- | --- |
| Solid 1.9 SSR, no framework | `1.9.x` | your server | none | `solid-js/web` |
| Solid 2.0 SSR, no framework | `2.0.0-rc.x` | `@solidjs/vite-plugin` | `vite.config.ts` | `@solidjs/web` |
| SolidStart 1 (legacy) | `1.x` | Vinxi, Nitro 2 | `app.config.ts` | `@solidjs/start`, `vinxi/http` |
| SolidStart 2 (stable) | **`1.9.x`** | Vite 8/9, Nitro 3 | `vite.config.ts` | `@solidjs/start/*` |
| Solid 2 start mode | `2.0.0-rc.x` | `@solidjs/vite-plugin` | `vite.config.ts` | `@solidjs/web`, `@solidjs/vite-plugin` |

The last row is the trap. **Released SolidStart 2 runs on Solid 1 and does not support Solid 2.** Solid 2 ships a fullstack mode in `@solidjs/vite-plugin`. That mode is not SolidStart and does not provide the SolidStart runtime. If a request says "Solid 2 plus SolidStart", ask which one the project actually has. Do not install Solid 2 into a SolidStart app.

`@solidjs/start@2.1.0` peers on `solid-js ^1.9.15`, Solid Router `>=0.16 <2.0.0-0`, Vite `^8 || ^9`, and Node `>=24`. `@solidjs/start@1.4.0` peers on `vinxi ^0.5.7`. Neither accepts a Solid 2 core.

## Core SSR

### Rendering functions

Solid 1.9, from `solid-js/web`:

```tsx
import { renderToString, renderToStream, HydrationScript } from "solid-js/web";
```

Solid 2.0, from `@solidjs/web`:

```tsx
import { renderToString, renderToStream, HydrationScript } from "@solidjs/web";
```

The names and the shapes agree. The import source does not.

| Function | Output | Use when |
| --- | --- | --- |
| `renderToString(() => <App />, options?)` | one HTML string | the tree resolves synchronously, or a pending `Loading` fallback is acceptable in the response |
| `renderToStream(() => <App />)` | shell first, then one fragment per settled boundary | the client should get real content later |
| `render(() => <App />, root)` | mounted tree, returns a disposer | client-only mount |
| `hydrate(() => <App />, root, options?)` | adopted server DOM | the root already holds SSR HTML |

`renderToStream` returns an object with a `ReadableStream<Uint8Array>`, pipe targets, and a thenable that resolves to the settled string. Pick one output form per render. Do not read the same stream twice.

`renderToString` in Solid 2 accepts `onHead`, which receives head HTML when the application does not own the document. For a document the renderer owns, put `<HydrationScript />` once in `<head>` before the application markup.

```tsx
// Solid 2, document owned by the renderer
const html = renderToString(() => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <HydrationScript />
    </head>
    <body>
      <div id="app"><App /></div>
    </body>
  </html>
));
```

Omit `HydrationScript` and the page loses clicks that fire before the client bundle hydrates. Include it twice and the second copy wastes bytes.

### Hydration is a structural contract

The server and the browser must produce the same element structure for each hydrated region. Solid assigns hydration keys during SSR. The client claims nodes by key and by position inside each template.

| Difference | What happens |
| --- | --- |
| element tag differs | dev warning `Hydration tag mismatch for key "..."` and bindings attach to the wrong node |
| structure branch differs | `Hydration structure mismatch: expected <X> ...` |
| client renders a root the server never emitted | `Hydration key miss for "..."`, and the element stays detached |
| server renders a root the client never claims | `Hydration completed with N unclaimed server-rendered node(s)` |
| text differs only | no warning. The server text stays until a reactive update replaces it |
| `dynamic()` resolves to a string tag with no server node | error `Hydration Mismatch. Unable to find DOM nodes for hydration key` |

Rules that follow:

- Never branch on `isServer` to choose a different tag or a different element count. Use it to skip a browser API, not to change markup.
- Compute `Math.random()`, `Date.now()`, `crypto.randomUUID()`, and `navigator.language` once on the server and pass the result as data. A value that decides which elements exist must not be computed independently on both sides.
- Use `createUniqueId()` for an `id` that a `for` attribute points at. It derives the id from the owner tree on both sides.
- Nest elements the way the HTML parser will keep them. `<div>` inside `<p>` and `<tr>` directly inside `<table>` are rewritten by the browser. The compiler rejects them inside one template but cannot see across a component boundary.

### Where each line runs

| Location | Server | Browser |
| --- | --- | --- |
| module scope | once per process, **shared by every request** | once |
| component body | once per request | once per mount |
| `createMemo` / compute function | yes | yes |
| `createEffect` compute function | once | yes |
| `createEffect` apply function | **no** | yes |
| `onMount` (v1) | **no** | yes |
| `onSettled` (v2) | **no**, reserves a hydration id | yes |
| event handler | no | yes |
| `"use server"` body | yes | becomes an HTTP request |

Module-scope signals or stores leak one request's state into another request's HTML. Create state inside a component or a context provider. That is one instance per request on the server and one per app in the browser.

A setter called during a server render updates nothing. Solid 2 development prints `[SERVER_WRITE]` the first time it happens.

### Keeping browser code off the server

Three places are safe for `window`, `document`, `localStorage`, and browser-only libraries:

1. an effect apply function
2. an `onMount` callback (v1) or `onSettled` callback (v2)
3. a subtree that renders only in the browser

```tsx
// Avoid: runs at import, on the server too
const saved = localStorage.getItem("cart");

// Prefer: read after hydration
const [cart, setCart] = createStore({ items: [] as CartItem[] });
onSettled(() => {
  const saved = localStorage.getItem("cart");
  if (saved) {
    setCart((draft) => {
      draft.items = JSON.parse(saved).items;
    });
  }
});
```

`isServer` is a build-time constant. Use it in a helper that has no owner, and keep its result out of JSX that decides element count.

| Version | `isServer` import | `clientOnly` import |
| --- | --- | --- |
| Solid 1.9 / SolidStart 1 | `solid-js/web` | `@solidjs/start` |
| Solid 2.0 | `@solidjs/web` | `@solidjs/web` |

`clientOnly` renders the fallback on the server, then swaps the component in after hydration. Pass `{ lazy: true }` to defer the import until first render.

## Serialization

### SolidStart 2 (stable, Solid 1.9)

Server function arguments and return values use Seroval.

| Mode | Default | CSP | Size |
| --- | --- | --- | --- |
| `json` | **yes** | strict CSP works, no `eval` | slightly larger |
| `js` | no | requires `unsafe-eval` | smaller |

```tsx
// vite.config.ts, SolidStart 2
solidStart({ serialization: { mode: "json" } })
```

SolidStart 1 defaults to `js`. SolidStart 2 defaults to `json`. Do not carry the v1 default into a new app.

Limits and types in Start 2:

- JSON mode enforces a maximum depth of 64.
- `RegExp` is disabled by default.
- `FormData`, `URLSearchParams`, `Uint8Array`, `ArrayBuffer`, `Blob`, `File`, and `string` bypass Seroval and travel directly.
- `Temporal` values survive if both runtimes provide a compatible global. Node 26+, Deno 2.7+, and Bun have no stable native `Temporal` at the time of writing. A polyfill must be imported for its global side effect in both entries.
- A custom type needs a Seroval plugin from `@solidjs/start/serialization`. Custom plugins do not affect the hydration payload that `@solidjs/web` produces.

### Solid 2 server functions

Solid 2 start mode sends arguments as JSON by default. A `Date`, `Map`, `Set`, typed array, or cyclic object in an argument list throws before the request. Call `enableRichArguments()` once in the client entry to opt in. Return values already use the codec when needed.

## SolidStart 2 (stable)

### Project shape

```tsx
// vite.config.ts
import { defineConfig } from "vite";
import { nitro } from "nitro/vite";
import { solidStart } from "@solidjs/start/config";

export default defineConfig({
  plugins: [solidStart(), nitro()],
  nitro: { preset: "node_server" },
});
```

```json
{ "scripts": { "dev": "vite dev", "build": "vite build", "preview": "vite preview" } }
```

Keep `app.config.ts` out of a v2 project. Framework options go to `solidStart()`. Server, deployment, prerender, task, and WebSocket options go to the top-level `nitro` property. Use Node 24 or newer.

### Entries and routing

`src/app.tsx` is the application root. `src/entry-client.tsx` and `src/entry-server.tsx` are generated defaults that you replace only when you need to.

`FileRoutes` from `@solidjs/start/router` maps `src/routes`:

| File | Path |
| --- | --- |
| `index.tsx` | `/` |
| `about.tsx` | `/about` |
| `blog/index.tsx` | `/blog` |
| `users/[id].tsx` | `/users/:id` |
| `users/[[id]].tsx` | `/users/:id?` |
| `docs/[...slug].tsx` | `/docs/*slug` |

A default export is a UI route. An exported `GET` or `POST` is an API route. An exported `route` object adds route behavior. `route.preload` warms a query before render.

### Data and mutations

```tsx
import { createAsync, query, type RouteDefinition } from "@solidjs/router";

const getPost = query(async (id: string) => {
  "use server";
  return db.posts.get(id);
}, "post");

export const route = { preload: ({ params }) => getPost(params.id) } satisfies RouteDefinition;

export default function PostPage(props: { params: { id: string } }) {
  const post = createAsync(() => getPost(props.params.id));
  return <article>{post()?.title}</article>;
}
```

`query` caches. `createAsync` reads inside the component. `"use server"` moves the body to the server. The action form is the same idea with `action` plus `useSubmission`.

```tsx
const saveProfile = action(async (formData: FormData) => {
  "use server";
  return updateProfile(formData);
}, "saveProfile");

// <form action={saveProfile} method="post">
```

`action.with(value)` prefills leading arguments. `useSubmission(action)` gives `pending`, `error`, and the result accessor. Pair the write path with the route `query` so revalidation is predictable.

### Middleware

```ts
import { createMiddleware } from "@solidjs/start/middleware";

export default createMiddleware([
  async (event, next) => {
    const started = Date.now();
    const response = await next();
    response.headers.set("x-duration", String(Date.now() - started));
    return response;
  },
]);
```

Point `solidStart({ middleware: "./src/middleware/index.ts" })` at the module. Each entry is an H3 v2 middleware. Before-`next()` runs in declaration order. After-`next()` runs in reverse. Returning a `Response` before `next()` short-circuits the chain.

The v1 `onRequest` / `onBeforeResponse` object form still works, but SolidStart deprecates it. In `2.0.0` the deprecated `onBeforeResponse` arrays run in declared order, so remove any manual reversal added for an earlier prerelease.

`@solidjs/start/http` and `@solidjs/start/middleware` are server-only. Importing them from client-reachable code fails the build. `getRequestEvent()` still comes from `solid-js/web` because Start 2 runs Solid 1.9.

Middleware is not authorization. Client navigation can reuse data and call server functions without a page request. Enforce authorization in each protected query, action, and API route.

### Sessions

Sessions in Start 2 come from H3 v2 through `@solidjs/start/http`.

```ts
import { useSession } from "@solidjs/start/http";

export async function useAppSession() {
  "use server";
  return useSession<{ userId?: string }>({
    name: "app-session",
    password: process.env.SESSION_SECRET!,
    cookie: { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" },
  });
}
```

Use a secret of at least 32 characters from a private environment variable. Keep the cookie small. For revocation or large payloads, store a record in a database and keep only an opaque id in the cookie.

Start 1 uses `vinxi/http` for the same helpers. The import path is the difference.

### Environment variables

Start 2 has virtual modules:

| Module | Exposure | Prefix |
| --- | --- | --- |
| `env:server` | build-time, server only, import from client fails | `SERVER_` |
| `env:client` | build-time, both environments | `CLIENT_` |
| `env:server/runtime` | runtime `process.env`, server only | none |

`import "server-only"` and `import "client-only"` are recognized markers. Add one to a module to make a wrong-environment import fail at build time. `@solidjs/start/http` and `@solidjs/start/middleware` already carry `server-only`.

## SolidStart 1 (legacy)

Recognize it by `app.config.ts`, `vinxi` in the dependencies, and `vinxi/http` imports.

```ts
// app.config.ts
import { defineConfig } from "@solidjs/start/config";
export default defineConfig({ server: { preset: "node-server" } });
```

| Concern | Start 1 | Start 2 |
| --- | --- | --- |
| Config | `app.config.ts` | `vite.config.ts` with `solidStart()` |
| Server toolkit | Vinxi, Nitro 2 | Vite 8/9, Nitro 3 |
| HTTP helpers | `vinxi/http` | `@solidjs/start/http` |
| Dev command | `vinxi dev` | `vite dev` |
| Serialization default | `js` | `json` |
| Custom middleware | `onRequest` / `onBeforeResponse` | array of H3 middleware |
| Env types | `@solidjs/start/env` | `@solidjs/start/env` |

Single-flight mutations are a Start 1 feature: a server function action plus a preloaded route query in one request. Do not assume the same mechanics in a different stack. Verify the request count.

## Solid 2 start mode

`@solidjs/vite-plugin` in start mode is a Vite application with SSR, server functions, and middleware. It is not SolidStart. There is no `solidStart()`, no `FileRoutes` from `@solidjs/start`, and no SolidStart serialization option.

```ts
// vite.config.ts, Solid 2 start mode
import { defineConfig } from "vite";
import solid from "@solidjs/vite-plugin";

export default defineConfig({
  plugins: [solid({ start: true, ssr: true })],
});
```

`start: true` turns the mode on. `ssr: true` selects streaming server rendering. Without it the build writes a static shell and the generated client entry calls `render()` instead of `hydrate()`. `src/App.tsx` and `src/Document.tsx` are the application surface. An authored `Document` in SSR mode must emit the `<html>` document and `<HydrationScript />`.

Server functions come from `@solidjs/web`. `getRequestEvent`, `respond`, and `enableRichArguments` are `@solidjs/web` exports. Routing is yours to choose: `@solidjs/router@2.0.0-next.x`, TanStack Router, or none.

Do not copy a SolidStart 2 config into this target and rename the plugin. The application contract differs. The official `migration/from-solid-start` guide treats the move as a rewrite, not an upgrade.

## Security

Every server function is an HTTP endpoint. TypeScript types do not exist at runtime. The browser's `required` attribute was never involved.

- Accept `unknown` at the boundary and parse before use. A schema library or a hand-written guard both work.
- Read the user from the request context. Do not read a user id from an argument.
- Enforce authorization in the function body. Middleware alone is not enough.
- Throw a `Response` for a status code. In Start 2, `serverFunctions.onError` can sanitize a thrown value before it reaches the client.
- Keep secrets in `env:server` or `env:server/runtime`. Never in `env:client` or a `CLIENT_` variable.
- Use a strict Content Security Policy with `json` serialization. `js` mode needs `unsafe-eval`.
- Escape user HTML. `innerHTML` is an injection point in both versions.

## SSR review checklist

1. Name the stack in the table at the top, with a version for each layer.
2. `HydrationScript` appears once in a document the renderer owns.
3. No `isServer` branch changes the element structure.
4. Every browser API sits in an effect apply function, an `onMount`/`onSettled` callback, or a `clientOnly` subtree.
5. No module-scope signal or store holds request data.
6. Generated ids use `createUniqueId`.
7. The server computes per-run values and passes them as data.
8. A `Loading` boundary sits above each async read that should not block the shell.
9. The handler parses and authorizes server function inputs inside the body.
10. Serialization mode matches the CSP.
11. Session secret comes from the environment and is at least 32 characters.
12. Load the page with JavaScript disabled at least once, for a UI that claims progressive enhancement.
