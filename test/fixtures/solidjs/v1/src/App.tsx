import { createEffect, createResource, createSignal, Index } from "solid-js";
import { createStore } from "solid-js/store";

const [rows, setRows] = createStore([{ id: "1", label: "one" }]);
const [selected, setSelected] = createSignal<string>();

createEffect(() => {
  console.log(selected());
});

const [user] = createResource(selected, async (id) => {
  const response = await fetch(`/api/users/${id}`);
  return (await response.json()) as { name: string };
});

export function App() {
  return (
    <Index each={rows}>
      {(row, index) => (
        <button onClick={() => setSelected(row().id)}>
          {index}: {row().label} {user()?.name}
        </button>
      )}
    </Index>
  );
}

export { setRows };
