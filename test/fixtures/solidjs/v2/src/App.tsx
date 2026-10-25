import { createEffect, createSignal, createStore, For, onSettled } from "solid-js";
import { render } from "@solidjs/web";

const [rows, setRows] = createStore({ list: [{ id: "1", label: "one" }] });
const [selected, setSelected] = createSignal<string>();

createEffect(
  () => selected(),
  (id) => {
    console.log(id);
  },
);

onSettled(() => {
  const saved = localStorage.getItem("selected");
  if (saved) setSelected(saved);
});

setRows((draft) => {
  draft.list.push({ id: "2", label: "two" });
});

export function App() {
  return (
    <For each={rows.list} keyed={(row) => row.id}>
      {(row) => <button onClick={() => setSelected(row().id)}>{row().label}</button>}
    </For>
  );
}

render(() => <App />, document.getElementById("app")!);
