# TypeScript

Solid's types are precise about the thing that breaks at runtime. Function calls and property access carry reactivity, so a type that erases the call erases the update. Keep the accessor, keep the props object, and let the compiler name the mismatch.

## `tsconfig.json`

**Solid 1.9**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "Preserve",
    "moduleResolution": "bundler",
    "jsx": "preserve",
    "jsxImportSource": "solid-js",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true
  },
  "include": ["src"]
}
```

**Solid 2.0 RC**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "Preserve",
    "moduleResolution": "bundler",
    "jsx": "preserve",
    "jsxImportSource": "@solidjs/web",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true
  },
  "include": ["src"]
}
```

`jsx: "preserve"` is required: the Solid compiler owns the JSX transform. `jsxImportSource` selects the renderer's JSX namespace. In 2.0, `solid-js` no longer provides one; `@solidjs/web` does. A custom renderer provides its own `jsx-runtime` and `jsx-dev-runtime` entries.

`verbatimModuleSyntax` is not required, but it catches a real class of bug: a value import of a type that the compiler would otherwise elide. Use `import type` for types.

## Component types

**Solid 1.9**

```tsx
import type { Component, JSX, ParentProps, FlowProps, ComponentProps } from "solid-js";

type ButtonProps = ParentProps<{
  variant?: "primary" | "secondary";
  onClick?: JSX.EventHandlerUnion<HTMLButtonElement, MouseEvent>;
}>;

const Button: Component<ButtonProps> = (props) => (
  <button class={props.variant ?? "primary"} onClick={props.onClick}>
    {props.children}
  </button>
);
```

**Solid 2.0 RC**

```tsx
import type { Component, Element, ParentProps, FlowProps, ComponentProps } from "solid-js";

type ButtonProps = ParentProps<{
  variant?: "primary" | "secondary";
  onClick?: (event: MouseEvent & { currentTarget: HTMLButtonElement }) => void;
}>;

const Button: Component<ButtonProps> = (props) => (
  <button class={props.variant ?? "primary"} onClick={props.onClick}>
    {props.children}
  </button>
);
```

- `Component<P>` is `(props: P) => Element`. It does not add `children`; use `ParentProps<P>` for that.
- `ParentComponent<P>` is `Component<ParentProps<P>>`.
- `FlowProps<P, C>` adds `when`/`each`/`fallback` and types the callback child. `FlowComponent` is the component form.
- `ComponentProps<typeof Button>` extracts the props type from a component. It is useful for wrapper components.
- In 2.0, a renderer-neutral component returns `Element` from `solid-js`. `JSX.Element` lives in `@solidjs/web`.

## Props and children

```tsx
type ListProps<T> = {
  items: readonly T[];
  render: (item: T, index: number) => JSX.Element;
  empty?: JSX.Element;
};

function List<T>(props: ListProps<T>) {
  return (
    <Show when={props.items.length > 0} fallback={props.empty}>
      <For each={props.items}>
        {(item, index) => props.render(item, index())}
      </For>
    </Show>
  );
}
```

- Generic components work. Keep the generic on the function, not on a `Component` alias that erases it.
- A callback child is a function prop. Type it with the exact arguments the control flow passes: `(item: T, index: Accessor<number>)` for `<For>` in 1.9, `(item: T, index: number)` for `<For keyed={false}>` in 2.0.
- `children?: JSX.Element` is permissive: it accepts strings, numbers, arrays, and fragments. If a component requires exactly one element, say so in the type or validate at runtime.
- Do not type a prop as `() => T` unless the component will call it. A signal accessor passed as a value is a function at runtime. The type is how you catch the mistake.

## Signals, memos, and stores

```tsx
import type { Accessor, Setter } from "solid-js";
import type { Store, SetStoreFunction } from "solid-js/store"; // 1.9
// 2.0: import type { Store, StoreSetter } from "solid-js";

type Counter = {
  count: Accessor<number>;
  setCount: Setter<number>;
};

const [state, setState] = createStore<{ todos: Todo[] }>({ todos: [] });
type State = typeof state;
```

- `Accessor<T>` is `() => T`. `Setter<T>` accepts a value or an updater.
- `createStore<T>` returns `[Store<T>, SetStoreFunction<T>]` in 1.9 and `[Store<T>, StoreSetter<T>]` in 2.0. `Store<T>` is `T` with reactive reads; it is not a distinct runtime shape.
- TypeScript types a store setter's path form with overloads. A typo in a path is a compile error in 1.9. In 2.0 the draft callback takes `T`, so a typo is also a compile error.
- `reconcile<T>(value, key?)` returns an updater; the key must exist on `T`.
- `createProjection<T>` returns `Store<T>`; the seed must match `T`.

## Events

Solid's JSX event props use the platform event type plus a narrowed `currentTarget`:

```tsx
function onInput(event: InputEvent & { currentTarget: HTMLInputElement }) {
  setQuery(event.currentTarget.value);
}

<input onInput={onInput} />;
```

- In 1.9, `JSX.EventHandlerUnion<T, E>` accepts either a delegated handler or an object with `handleEvent`. `JSX.EventHandler<T, E>` is the function form.
- In 2.0, type the handler directly. The JSX types are in `@solidjs/web`.
- `event.currentTarget` is typed from the element, so do not cast it. If you need `event.target`, narrow it with `instanceof`.
- A native listener with options (capture, passive) is not a JSX prop. Use a ref and `addEventListener`.

## Context

```tsx
type TodosContextValue = {
  todos: Store<Todo[]>;
  addTodo: (text: string) => void;
};

const TodosContext = createContext<TodosContextValue>(); // 1.9: T | undefined
// 2.0: Context<T>, useContext returns T
```

- In 1.9, the default-less form is `Context<T | undefined>`. A `useTodos` wrapper that throws is the supported narrowing.
- In 2.0, the default-less form is `Context<T>`. The wrapper is unnecessary.
- `createContext<T>(defaultValue)` keeps the default in both versions.
- Do not type the context as `any` to avoid the undefined branch. That branch is the missing-provider bug.

## SolidStart and router types

```tsx
import type { RouteDefinition, RouteSectionProps } from "@solidjs/router";

export const route: RouteDefinition = {
  preload: ({ params }) => getUserQuery(params.id as string),
};

export default function UserPage(props: RouteSectionProps) {
  return <h1>{props.params.id}</h1>;
}
```

- `RouteDefinition` types `preload`, `load`, `action`, `data`, and `info`.
- `RouteSectionProps` carries `params`, `location`, `data`, and `children`.
- `query` and `action` infer their argument and return types from the function. Do not annotate them with `any`; the inference is the contract.
- `createAsync(() => query(...))` returns `Accessor<T | undefined>`; branch on it or put it under a boundary.

## Common compiler errors and what they mean

| Error | Meaning | Fix |
| --- | --- | --- |
| `Type '() => number' is not assignable to type 'number'` | Passed a signal accessor where a value is expected | Call it at the JSX boundary: `count={count()}` |
| `Property 'children' does not exist on type ...` | Used `Component<P>` without `ParentProps` | `ParentProps<P>` or add `children` to `P` |
| `Cannot find namespace 'JSX'` in 2.0 | `solid-js` no longer owns JSX types | Import `JSX` from `@solidjs/web`, or use `Element` |
| `Cannot find module 'solid-js/web'` in 2.0 | The subpath was removed | Import from `@solidjs/web` |
| `Cannot find module 'solid-js/store'` in 2.0 | The subpath was removed | Import store APIs from `solid-js` |
| `Type 'T \| undefined' is not assignable to type 'T'` | A 1.9 context without a default | Add a `useX` wrapper or a default |
| `Argument of type 'string' is not assignable to parameter of type 'never'` | A store path that does not exist | Fix the path, or use the draft form in 2.0 |
| `Property 'loading' does not exist on type ...` in 2.0 | `createResource` was removed | Use an async memo/store and `<Loading>` |
| `Expected 2 arguments, but got 1` on `createEffect` in 2.0 | The split effect is required | Add the apply function |
| `This expression is not callable` on a `<For keyed={false}>` item | The item is an accessor | Call it: `item()` |

## Type discipline

- **Do not cast around a prop mismatch.** `props.user as User` hides the case where the parent passes a different shape. Type the parent and the child from one source.
- **Do not widen a signal to `any`.** `const [state, setState] = createSignal<any>(...)` erases the store and prop checks that catch the bug.
- **Use discriminated unions for state.** `{ status: "loading" } | { status: "ready"; data: T } | { status: "error"; error: E }` makes the impossible state unrepresentable and removes the `data!` non-null assertion.
- **Use `satisfies` for config.** `const config = { ... } satisfies Config` checks the shape without widening the literal types.
- **Keep the version's JSX type.** A v2 project that imports `JSX` from `solid-js` compiles against a namespace that no longer exists; the fix is the import, not a `// @ts-ignore`.
- **Type the boundary, not the internals.** A server function, a query, an action, and a store seed are the contracts. Inside a component, inference is usually enough.
