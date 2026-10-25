/**
 * Solid 1.9 components. Compiled only; not executed.
 *
 * The shapes here are the ones a review should accept: props kept as an
 * object, an owned ref callback, `Index` for a stable row shape, and a
 * context provider with a narrowed consumer.
 */
import {
  children,
  createContext,
  createSignal,
  For,
  Index,
  Match,
  mergeProps,
  onCleanup,
  Show,
  splitProps,
  Switch,
  useContext,
  type Component,
  type JSX,
} from "solid-js";
import { Dynamic } from "solid-js/web";

export function Button(
  props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: "primary" | "ghost";
  },
) {
  const [local, rest] = splitProps(props, ["variant", "class", "children"]);
  const merged = mergeProps({ variant: "primary" as const, class: "" }, local);

  return (
    <button {...rest} class={`btn btn-${merged.variant} ${merged.class}`}>
      {merged.children}
    </button>
  );
}

export function Card(props: { title: string; children?: JSX.Element }) {
  const resolved = children(() => props.children);

  return (
    <section class="card">
      <h2>{props.title}</h2>
      {resolved()}
    </section>
  );
}

type ThemeValue = {
  readonly name: string;
  setTheme: (name: string) => void;
};

const ThemeContext = createContext<ThemeValue>();

export function ThemeProvider(props: { children?: JSX.Element }) {
  const [name, setName] = createSignal("light");
  const value: ThemeValue = {
    get name() {
      return name();
    },
    setTheme: setName,
  };

  return (
    <ThemeContext.Provider value={value}>
      {props.children}
    </ThemeContext.Provider>
  );
}

export function ThemeLabel() {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error("ThemeLabel must be inside ThemeProvider");
  return <span>{theme.name}</span>;
}

export function Rows(props: { rows: Array<{ id: string; label: string }> }) {
  return (
    <>
      <For each={props.rows}>{(row) => <p>{row.label}</p>}</For>

      <Index each={props.rows}>
        {(row, index) => (
          <p>
            {index}: {row().label}
          </p>
        )}
      </Index>

      <Show when={props.rows[0]} fallback={<p>Empty</p>}>
        {(row) => <p>{row().label}</p>}
      </Show>

      <Switch fallback={<p>none</p>}>
        <Match when={props.rows.length > 1}>
          <p>many</p>
        </Match>
        <Match when={props.rows.length === 1}>
          <p>one</p>
        </Match>
      </Switch>
    </>
  );
}

export function Tag(props: { as: Component<{ children?: JSX.Element }>; children?: JSX.Element }) {
  return <Dynamic component={props.as}>{props.children}</Dynamic>;
}

export function FocusInput() {
  return (
    <input
      ref={(element) => {
        element.focus();
        onCleanup(() => element.blur());
      }}
    />
  );
}

export function Badge(props: { active: boolean }) {
  return (
    <span class="badge" classList={{ "badge-active": props.active }}>
      new
    </span>
  );
}
