# Testing and review

## Pick the smallest environment

| What you test | Environment | Why |
| --- | --- | --- |
| a component's visible behavior | jsdom or happy-dom | fast, no layout |
| focus, selection, CSS, `IntersectionObserver` | a real browser (Vitest browser mode) | jsdom does not implement layout |
| reactive primitives | plain Node | no DOM involved |
| server functions, sessions, route handlers | Node, separate project | request-scoped state must not share a DOM setup |
| hydration | jsdom with `hydrate: true`, plus one real browser pass | mismatches are easy to miss in a simulated DOM |

The test runner must use the same JSX transform as the app. Reuse the app's Vite config and add a `test` block. Do not hand-write a second transform for tests.

## Setup by version

### Solid 1.9

```sh
bun add -d vitest jsdom @solidjs/testing-library @testing-library/jest-dom @testing-library/user-event
```

```ts
// vite.config.ts
import { defineConfig } from "vitest/config";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  test: { environment: "jsdom", globals: false, setupFiles: ["./vitest-setup.ts"] },
});
```

`@solidjs/testing-library@0.8.10` peers on `solid-js >=1.0`.

### Solid 2.0

```sh
bun add -d vitest jsdom @solidjs/testing-library@1.0.0-rc.2 @testing-library/jest-dom @testing-library/user-event
```

```ts
// vite.config.ts
import { defineConfig } from "vitest/config";
import solid from "@solidjs/vite-plugin";

export default defineConfig({
  plugins: [solid()],
  test: { environment: "jsdom", globals: false, setupFiles: ["./vitest-setup.ts"] },
});
```

`@solidjs/testing-library@1.0.0-rc.2` peers on `solid-js >=2.0.0-0` and `@solidjs/web >=2.0.0-0`. The 0.8 line does not work with Solid 2.

### Both

```ts
// vitest-setup.ts
import "@testing-library/jest-dom/vitest";
```

Add `@testing-library/jest-dom` to `tsconfig.json` `compilerOptions.types` when the matchers do not typecheck.

## The batching difference

Solid 2 batches writes on a microtask. A test that asserts on the line after a click sees the old DOM.

```tsx
// Solid 2
fireEvent.click(button);
flush();
expect(button).toHaveTextContent("Clicks: 1");
```

`flush()` comes from `solid-js`. It commits staged writes and drains queued effects. It does not wait for async work.

Solid 1 does not have this problem with `fireEvent`, because the testing library batches the event synchronously. An async `userEvent` interaction still needs `await`. Do not copy a `flush()` call into a Solid 1 test. It does not exist there.

## Component tests

```tsx
import { cleanup, fireEvent, render } from "@solidjs/testing-library";
import { flush } from "solid-js";
import { afterEach, expect, test } from "vitest";

afterEach(cleanup);

test("increments on click", () => {
  const { getByRole } = render(() => <Counter />);
  const button = getByRole("button");

  expect(button).toHaveTextContent("Clicks: 0");
  fireEvent.click(button);
  flush();
  expect(button).toHaveTextContent("Clicks: 1");
});
```

Rules:

- Pass a function to `render`: `render(() => <Counter />)`. The test runner evaluates a direct element before the test owner exists.
- Query by role and accessible name. Do not query by class or by internal test id when a role exists.
- Call `cleanup` after each test. The library can register it automatically only when the runner exposes a global `afterEach`.
- Assert what the user sees. A signal value, an effect count, or compiled output is not the contract.

The `render` options you will use: `wrapper` for a context provider, `location` for a router, `hydrate: true` to hydrate markup, and `container` for an explicit root.

## Primitive tests

A primitive needs an owner. Create one and dispose it.

```ts
import { createRoot, createSignal } from "solid-js";
import { expect, test } from "vitest";

test("doubles", () => {
  const dispose = createRoot((dispose) => {
    const [count, setCount] = createSignal(1);
    const doubled = () => count() * 2;
    expect(doubled()).toBe(2);
    setCount(2);
    flush();
    expect(doubled()).toBe(4);
    return dispose;
  });
  dispose();
});
```

Without `createRoot`, an effect or memo has no owner and the test leaks it. Dispose the root at the end, including on failure. A `try/finally` is clearer than a bare call when the test can throw.

For an effect, assert the side effect, not the number of runs:

```ts
const seen: number[] = [];
createRoot((dispose) => {
  const [count, setCount] = createSignal(0);
  createEffect(() => count(), (value) => { seen.push(value); });
  setCount(1);
  flush();
  setCount(2);
  flush();
  dispose();
});
expect(seen).toEqual([1, 2]);
```

## Async tests

| Situation | Tool |
| --- | --- |
| an async memo or route query | `await screen.findBy...` or `await resolve(() => value())` |
| a timer-driven update | `vi.useFakeTimers()` plus `await vi.advanceTimersByTimeAsync()` |
| an abortable request | assert that the second result wins, not that the first was called |
| a pending transition | `isPending` in the app, `await` the submission in the test |

Do not use `flush()` to wait for a promise. It drains synchronous work only.

A race test needs two deferred promises that resolve out of order:

```ts
let resolveFirst!: (value: string) => void;
let resolveSecond!: (value: string) => void;
const first = new Promise<string>((resolve) => { resolveFirst = resolve; });
const second = new Promise<string>((resolve) => { resolveSecond = resolve; });

const load = (promise: Promise<string>) => {
  const controller = new AbortController();
  promise.then((value) => { if (!controller.signal.aborted) setValue(value); });
  return () => controller.abort();
};

const dispose = createRoot((dispose) => {
  createEffect(() => source(), () => load(first));
  createEffect(() => other(), () => load(second));
  return dispose;
});

resolveSecond("new");
resolveFirst("old");
flush();
expect(value()).toBe("new");
```

## SSR and hydration tests

```tsx
import { renderToString } from "@solidjs/web"; // solid-js/web on 1.9
import { hydrate } from "@solidjs/web";

test("server output contains the heading", () => {
  const html = renderToString(() => <App />);
  expect(html).toContain("<h1>Products</h1>");
});

test("hydrates without a mismatch", () => {
  const html = renderToString(() => <App />);
  document.body.innerHTML = `<div id="app">${html}</div>`;
  const errors: string[] = [];
  const spy = vi.spyOn(console, "error").mockImplementation((message) => {
    errors.push(String(message));
  });
  hydrate(() => <App />, document.getElementById("app")!);
  spy.mockRestore();
  expect(errors.filter((line) => line.includes("Hydration"))).toEqual([]);
});
```

Checklist for an SSR test:

- Render a route with data the server has, not with an empty seed.
- Assert the first paint contains the content, not a spinner, when the route preloads.
- Hydrate the same markup and assert no `Hydration ...` console message.
- Include one test with a browser-only value, such as `Date.now()`, and assert the first text equals the server text.
- Run one real browser test with JavaScript disabled for any page that claims progressive enhancement.

## SolidStart tests

| Layer | Test |
| --- | --- |
| route component | render with `@solidjs/testing-library`, pass a router wrapper when the component reads `useParams` |
| `query` / `createAsync` | call the query directly against a test database, then assert the component renders the value |
| `action` | call the action with a `FormData`, assert the write and the returned value |
| session | call the helper inside a request context, assert the cookie flags and the stored fields |
| middleware | call the middleware with a `Request` and a `next` stub, assert order and headers |
| serialization | send a payload through the configured mode and assert the round trip |

SolidStart 2 runs on Solid 1.9. Use `@solidjs/testing-library@0.8.10` there, not the 1.0 RC.

A server function is an HTTP endpoint. Test the body with an untrusted input:

```ts
test("rejects a non-string name", async () => {
  await expect(updateAccountName({ admin: true })).rejects.toBeInstanceOf(Response);
});
```

## Accessibility tests

- Every form control has a label, either a `<label for>` or `aria-label`.
- Every `<img>` has `alt`. A decorative image uses `alt=""`.
- Every interactive element is reachable by keyboard and shows a focus style.
- A dialog traps focus and restores it on close.
- The field owns an error message through `aria-describedby`, and a live region announces it when it appears after submit.

`vitest-axe` can catch missing labels and roles. It cannot catch a focus trap or an announcement. Keep one manual keyboard pass per release.

## What not to assert

- Do not assert an effect ran N times. Assert the result.
- Do not assert a signal's identity. Assert the rendered value.
- Do not assert compiled output. It changes between compiler versions.
- Do not snapshot a whole page. A snapshot accepts a hydration mismatch as the baseline.
- Do not mock `solid-js`. The reactivity is the thing under test.

## Review checklist

Use this on a diff, in order.

1. **Version.** Every file's imports match the detected version. No `@solidjs/web` in a 1.9 app, no `solid-js/web` in a 2.0 app.
2. **Reactivity.** Every read that must update sits in JSX or a reactive scope. No captured value from setup.
3. **Derivation.** A value computed from other values uses `createMemo`. An effect performs a side effect.
4. **Ownership.** Every subscription, timer, listener, and async request has a cleanup or an abort.
5. **Props.** The `props` object is kept. No destructuring in the signature.
6. **Lists.** `<For>` or `<For keyed={false}>`, never `.map()`, never a `key` prop.
7. **Stores.** Draft setters in 2.0. Block bodies for mutations. No root spread.
8. **Async.** A pending read has a boundary. A race has a guard. A server read is preloaded.
9. **SSR.** No browser global at module scope. No `isServer` branch that changes markup. No per-run value in render.
10. **Types.** No `any` at a component or store boundary. `jsxImportSource` matches the version.
11. **A11y.** Labels, `alt`, keyboard path, and focus management.
12. **Security.** Server function input is parsed. Authorization is in the function. No user HTML through `innerHTML`.
13. **Tests.** The behavior under test has a test that fails when the behavior regresses.

## Running the skill's checks

Call the tool in the session:

```ts
await tools.spectre.solidjs({ action: "detect", target: "." });
await tools.spectre.solidjs({ action: "audit", target: "." });
```

`detect` returns `mode`, `solid.line`, `framework`, and `incompatible`. A `mode` of `unknown` or `mixed`, or `compatible: false`, stops the task before any code is written. `audit` returns `status: "ok"` with `findings`, `errors`, `warnings`, and `total`, or `status: "refused"` when the target is not a directory. A `warn` finding is a review item. An `error` finding is a failure.

The audit is a Spectre tool, not a standalone CLI. A project CI still gates on its own `tsc`, build, and tests. To get these exact rules in CI, port the rule ids you rely on to the project's lint. Or run the tool from a Spectre job.

A text audit has false positives. Read the finding before you change code:

- A string literal that contains `onClick` is not an event binding.
- A test fixture may intentionally contain a v1 call. Exclude the fixture directory.
- The mask hides a comment before matching, so a code sample in a comment does not fire.
- A one-argument `createEffect` is correct in Solid 1.9 and an error in 2.0. The detector decides which message you get.
