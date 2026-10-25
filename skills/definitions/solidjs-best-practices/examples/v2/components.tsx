/**
 * Solid 2.0 components. Compiled only; not executed.
 *
 * The three `For` modes have three callback shapes. `Errored` receives an
 * error accessor. A context is its own provider.
 */
import {
  children,
  createContext,
  createSignal,
  createUniqueId,
  Errored,
  For,
  Loading,
  Match,
  merge,
  omit,
  onSettled,
  Repeat,
  Reveal,
  Show,
  Switch,
  useContext,
  type Component,
  type Element,
} from "solid-js";
import { dynamic, Portal, type JSX } from "@solidjs/web";

export function Button(
  props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: "primary" | "ghost";
  },
) {
  const merged = merge({ variant: "primary" as const, class: "" }, props);
  const rest = omit(merged, "variant", "class");

  return (
    <button {...rest} class={`btn btn-${merged.variant} ${merged.class}`}>
      {merged.children}
    </button>
  );
}

export function Card(props: { title: string; children?: Element }) {
  const resolved = children(() => props.children);
  const titleId = createUniqueId();

  return (
    <section class="card" aria-labelledby={titleId}>
      <h2 id={titleId}>{props.title}</h2>
      {resolved()}
    </section>
  );
}

type ThemeValue = {
  readonly name: string;
  setTheme: (name: string) => void;
};

const ThemeContext = createContext<ThemeValue>();

export function ThemeProvider(props: { children?: Element }) {
  const [name, setName] = createSignal("light");
  const value: ThemeValue = {
    get name() {
      return name();
    },
    setTheme: setName,
  };

  return <ThemeContext value={value}>{props.children}</ThemeContext>;
}

export function ThemeLabel() {
  const theme = useContext(ThemeContext);
  return <span>{theme.name}</span>;
}

type Row = { id: string; label: string };

export function Rows(props: { rows: Row[] }) {
  return (
    <>
      <For each={props.rows}>
        {(row, index) => (
          <p>
            {index()}: {row.label}
          </p>
        )}
      </For>

      <For each={props.rows} keyed={false}>
        {(row, index) => (
          <p>
            {index}: {row().label}
          </p>
        )}
      </For>

      <For each={props.rows} keyed={(row) => row.id}>
        {(row, index) => (
          <p>
            {index()}: {row().label}
          </p>
        )}
      </For>

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

      <Repeat count={props.rows.length} fallback={<p>none</p>}>
        {(index) => <p>{props.rows[index]?.label}</p>}
      </Repeat>
    </>
  );
}

const Heading = dynamic<"h1" | "h2">(() => "h2");

export function Article(props: { title: string; children?: Element }) {
  return (
    <article>
      <Heading>{props.title}</Heading>
      {props.children}
    </article>
  );
}

export function AsyncPanel(props: { load: () => string }) {
  return (
    <Errored
      fallback={(error, reset) => {
        const value = error();
        return (
          <div role="alert">
            <p>{value instanceof Error ? value.message : String(value)}</p>
            <button onClick={reset}>Retry</button>
          </div>
        );
      }}
    >
      <Loading fallback={<p aria-busy="true">Loading</p>}>
        <Reveal order="sequential" collapsed>
          <p>{props.load()}</p>
        </Reveal>
      </Loading>
    </Errored>
  );
}

function focusOnMount() {
  let element: HTMLInputElement | undefined;

  onSettled(() => {
    element?.focus();
  });

  return (next: HTMLInputElement) => {
    element = next;
  };
}

export function Search() {
  return <input ref={focusOnMount()} type="search" aria-label="Search" />;
}

export function Modal(props: { children?: Element }) {
  return (
    <Portal>
      <div role="dialog" aria-modal="true">
        {props.children}
      </div>
    </Portal>
  );
}

export const heading: Component<{ children?: Element }> = (props) => (
  <h1>{props.children}</h1>
);
