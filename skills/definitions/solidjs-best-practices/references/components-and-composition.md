# Components, composition, forms, and accessibility

A Solid component is a function that runs once and returns JSX. Composition is therefore not about re-running a tree. It is about which owner creates a primitive, which object carries reactivity, and which DOM node receives the result.

## Props

Props are one reactive object. The compiler turns a dynamic attribute into a getter on that object. The read then happens where the child reads it, in the child's tracking scope.

```tsx
// Solid 1.9: JSX.Element. Solid 2.0: import type { Element } from "solid-js".
type CardProps = {
  title: string;
  count: number;
  children?: JSX.Element;
};

function Card(props: CardProps) {
  return (
    <article>
      <h2>{props.title}</h2>
      <p>{props.count} items</p>
      {props.children}
    </article>
  );
}
```

Rules:

- **Do not destructure.** `function Card({ title }: CardProps)` reads the getter once in the body and freezes it.
- **Do not assign to a local and expect it to update.** `const title = props.title` has the same problem. Use `createMemo(() => props.title)` if the value needs its own identity.
- **Pass values, not accessors.** `<Card count={count()} />`, not `<Card count={count} />`. The child's prop type is `number`, not `() => number`.
- **Do not mutate props.** A child that needs to change a value calls a callback prop from an event handler.
- **Props are read-only but not frozen.** Spreading them onto a DOM element passes `children`, event handlers, and component-only props too. Use `splitProps` (1.9) or `omit` (2.0) to separate them.

```tsx
// Solid 1.9
function Button(props: ButtonProps) {
  const [local, rest] = splitProps(props, ["variant", "children"]);
  return <button class={local.variant} {...rest}>{local.children}</button>;
}
```

```tsx
// Solid 2.0
function Button(props: ButtonProps) {
  const rest = omit(props, "variant", "children");
  return <button class={props.variant} {...rest}>{props.children}</button>;
}
```

`mergeProps` (1.9) / `merge` (2.0) fills defaults without losing reactivity:

```tsx
const merged = mergeProps({ variant: "primary" }, props);
```

In 2.0, `undefined` is a real value in `merge`: `merge({ a: 1 }, { a: undefined }).a` is `undefined`, not `1`.

## Children

`props.children` is a reactive getter. Reading it once in the body is usually enough because the JSX is inserted into the returned tree. If the same children are read more than once, or a wrapper needs to inspect them, use `children`:

```tsx
// Solid 1.9: JSX.Element. Solid 2.0: import type { Element } from "solid-js".
import { children, type JSX } from "solid-js";

function Panel(props: { children: JSX.Element }) {
  const resolved = children(() => props.children);
  return (
    <section>
      <header>Panel</header>
      {resolved()}
    </section>
  );
}
```

- `children` memoizes the resolved value. Call `resolved()` where it is rendered, not at the top of the component.
- A component that accepts children should type them as `JSX.Element` (1.9) or `Element` (2.0) and should not assume a single node.
  `ParentProps` adds `children` to a props type. `FlowProps` adds the flow-control props (`when`, `each`, `fallback`).
- A render prop is a function prop. It is not a child in the Solid sense. Call it inside JSX so its reads track.

## Context

Context carries a value down the owner tree without prop drilling. The value should be stable or reactive, not a fresh object on every render.

**Solid 1.9**

```tsx
const TodosContext = createContext<TodosContextValue>();

function App() {
  const [todos, setTodos] = createStore<Todo[]>([]);
  const value: TodosContextValue = { todos, addTodo };
  return (
    <TodosContext.Provider value={value}>
      <List />
    </TodosContext.Provider>
  );
}

function useTodos(): TodosContextValue {
  const value = useContext(TodosContext);
  if (value === undefined) throw new Error("TodosContext is missing");
  return value;
}
```

**Solid 2.0 RC**

```tsx
const TodosContext = createContext<TodosContextValue>();

function App() {
  const [todos, setTodos] = createStore<Todo[]>([]);
  const value: TodosContextValue = { todos, addTodo };
  return (
    <TodosContext value={value}>
      <List />
    </TodosContext>
  );
}

function useTodos(): TodosContextValue {
  return useContext(TodosContext); // T, throws ContextNotFoundError if missing
}
```

- A default value is for a primitive fallback (theme, locale, frozen config). For reactive state, use the default-less form so a missing provider is a loud error.
- `undefined` is never a context value in 2.0. Use `null` for an explicit empty value.
- Do not create the context value object inline if a consumer depends on identity. Store it in a memo or a stable object. The values inside can still be reactive.

## Control flow

Solid's control flow compiles to code. It is not a runtime component that re-renders its children. Use it instead of `&&`, ternaries, and `.map()` for anything with more than one branch.

| Need | Solid 1.9 | Solid 2.0 RC |
| --- | --- | --- |
| One condition | `<Show when={x()} fallback={...}>` | same |
| Many branches | `<Switch>` / `<Match>` | same |
| List by identity | `<For each={items()}>` | `<For each={items()}>` |
| List by index | `<Index each={items()}>` | `<For each={items()} keyed={false}>` |
| Count/range | `<For each={Array.from({ length: n })}>` | `<Repeat count={n}>` |
| Dynamic component | `<Dynamic component={...}>` | `dynamic(source)` factory |
| Portal | `<Portal mount={...}>` | same, from `@solidjs/web` |
| Async boundary | `<Suspense>` | `<Loading>` |
| Error boundary | `<ErrorBoundary>` | `<Errored>` |
| Sibling reveal order | `<SuspenseList>` | `<Reveal>` |

### `Show` and `Match`

The function child receives an accessor, so the narrowed value is safe to read:

```tsx
<Show when={user()} fallback={<Login />}>
  {(current) => <Profile user={current()} />}
</Show>
```

A ternary in JSX does not narrow and re-evaluates the condition in two places. Use `Show`.

`Switch`/`Match` is for mutually exclusive branches. `Match` also passes an accessor to its function child.

### Lists

```tsx
<For each={todos()} fallback={<p>Nothing to do.</p>}>
  {(todo, index) => <TodoRow todo={todo} index={index()} />}
</For>
```

- `<For>` keys by item identity. If the same object moves, its DOM and local state move with it.
- The index is an accessor in `<For>` (both versions). Call it if you need the number.
- `<Index>` (1.9) keys by index and passes the item as an accessor. Use it for a stable shape where the values change but the rows do not (a fixed table, a set of cells).
- In 2.0, `<For keyed={false}>` gives an item accessor and a plain number. This is the `Index` replacement:

```tsx
<For each={rows()} keyed={false}>
  {(row, index) => <Cell value={row()} index={index} />}
</For>
```

- Do not use `.map()` for a dynamic list. It recreates every node on every change and loses focus, selection, and component state.
- A list row that owns a resource or a signal should be a component with a stable identity. Do not create primitives in a loop body that runs again. The loop body in `<For>` runs once per item.

## Refs and DOM access

A ref receives the element after Solid creates it.

```tsx
let input: HTMLInputElement | undefined;

onMount(() => input?.focus()); // 1.9
onSettled(() => input?.focus()); // 2.0

<input ref={input} />;
```

- In 1.9, a ref callback runs inside the component's owner, so `onCleanup` inside it works.
- In 2.0, a ref callback has no owner. Put lifecycle work in `onSettled` or a directive factory.
- Use a ref for focus, measurement, scroll, canvas, media, and third-party widgets. Do not use it to read a value that should be state.
- `use:` directives are 1.9 only. In 2.0, a directive is a factory that returns a ref callback:

```tsx
function autofocus() {
  return (el: HTMLInputElement) => queueMicrotask(() => el.focus());
}

<input ref={autofocus()} />;
```

## Forms

### Controlled inputs

Solid writes an input's `value` when the binding re-runs. It does not re-render the component on every keystroke.

```tsx
const [name, setName] = createSignal("");

<input
  value={name()}
  onInput={(event) => setName(event.currentTarget.value)}
/>;
```

- Use `onInput` for live text, `onChange` for commit-on-blur, and `onSubmit` on the form.
- For a checkbox, bind `checked`. For a select, bind `value` on the `<select>`.
- A controlled input that rejects a keystroke must also write the DOM value back. An unchanged signal does not revert the element:

```tsx
function onInput(event: InputEvent & { currentTarget: HTMLInputElement }) {
  const next = event.currentTarget.value.replace(/\D/g, "");
  setPhone(next);
  if (event.currentTarget.value !== next) event.currentTarget.value = next;
}
```

- Solid 2.0 development warns `UNCOMMITTED_INPUT_OVERWRITTEN` when a change to another dynamic attribute in the same template re-runs the `value` binding and erases typed text. Keep typing in a draft signal and commit on change or submit when the form is expensive.

### Form actions in SolidStart

You can pass a server action to `<form action={...} method="post">`. The action receives `FormData`. `useSubmission` exposes pending and error state. SolidStart 1 and 2 share this pattern, with different imports for HTTP helpers. See `ssr-and-solidstart.md`.

### Validation and errors

- Put the error next to the field and link it with `aria-describedby`.
- Set `aria-invalid={Boolean(error())}`.
- Do not rely on color alone. The message is the signal.
- Disable the submit button while pending, but keep the form submittable by keyboard. A disabled button is not focusable.

## Accessibility

Solid does not add a DOM layer, so the platform rules apply directly. The common failures are the same as any web app, plus a few Solid-specific ones.

- **Use the right element.** `<button type="button">` for an action, `<a href>` for navigation, `<label for={id}>` for a field. A clickable `<div>` needs a role, a tab index, and key handling; a button needs none of that.
- **Label every field.** A visible `<label>` is best. If the design hides it, use `aria-label` or `aria-labelledby`, not a placeholder as the only label.
- **Give every image an `alt`.** `alt=""` for decorative images; a description for informative ones.
- **Keep focus visible.** Do not remove the outline without a replacement. Route changes should move focus to the new heading or main region.
- **Announce async state.** A `<Loading>` fallback is visible, but a screen reader needs an `aria-live="polite"` status for "saving" and "saved". Do not put `aria-live` on a region that changes on every keystroke.
- **Do not put interactive handlers on non-interactive elements.** `onClick` on a `<div>` is a keyboard trap waiting to happen.
- **Use `createUniqueId` for generated ids.** It is SSR-safe and stable across hydration.

```tsx
const id = createUniqueId();
const errorId = `${id}-error`;

<label for={id}>Email</label>
<input id={id} aria-invalid={Boolean(error())} aria-describedby={error() ? errorId : undefined} />
<Show when={error()}>
  {(message) => <p id={errorId} role="alert">{message()}</p>}
</Show>
```

## Composition patterns

- **Pass the smallest value.** A child that needs a name should not receive the whole user object unless it needs the object.
- **Pass callbacks, not setters, across a boundary.** `onSave(next)` keeps the child independent of where the state lives; `setUser` couples it to the store shape.
- **Keep providers at the owner that outlives the readers.** A provider inside a conditional branch disposes its value when the branch flips.
- **Prefer a component to a render prop** unless the render prop needs the parent's scope. A component is easier to type and to test.
- **Do not create a primitive in a getter that runs on every read.** `const doubled = () => createMemo(...)` creates a memo per call. Create it once in the component body.
- **Do not memoize by default.** A memo costs a node and an equality check. Use one when the derivation is shared, expensive, or needs to stop propagation.

## Version checklist

| Concern | Solid 1.9 | Solid 2.0 RC |
| --- | --- | --- |
| Props helper | `splitProps`, `mergeProps` | `omit`, `merge` |
| Context provider | `<Ctx.Provider value>` | `<Ctx value>` |
| Context missing | `T \| undefined` | throws `ContextNotFoundError` |
| Index list | `<Index each>` | `<For keyed={false}>` |
| Dynamic | `<Dynamic component>` | `dynamic(source)` |
| Ref cleanup | owned; `onCleanup` works | unowned; use `onSettled`/factory |
| Directive | `use:name` | `ref={factory()}` |
| Class list | `classList={{}}` | `class={{}}` or `class={[]}` |
| Event case | `onClick` and lowercase `onclick` both bind | `onClick` only; lowercase is an attribute |
| Async boundary | `<Suspense>` | `<Loading>` |
| Error boundary | `<ErrorBoundary>` | `<Errored>` |
