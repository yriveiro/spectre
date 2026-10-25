import { createEffect, createResource, createSignal, createStore, Index } from "solid-js";

const [count, setCount] = createSignal(0);
const [user] = createResource(() => "id", (id) => id);

createEffect(() => {
  console.log(count());
});

const [store, setStore] = createStore({
  user: { name: "" },
  list: [] as string[],
});

setStore("user", "name", "Ada");
setStore((s) => s.list.push("one"));

export function Bad(props: any) {
  return (
    <div>
      <Index each={store.list}>{() => null}</Index>
      <div classList={{ active: count() > 0 }} />
      <img src="/logo.png" />
      <div innerHTML={props.html} />
      <p>{store.user.name}</p>
    </div>
  );
}

export { setCount };
