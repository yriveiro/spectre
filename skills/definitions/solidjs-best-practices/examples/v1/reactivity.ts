/**
 * Solid 1.9 reactivity. Compiled only; not executed.
 *
 * Every call here is the stable `solid-js@1.9` API. If the compiler rejects
 * this file, the skill's 1.9 reference and this example disagree.
 */
import {
  batch,
  createEffect,
  createMemo,
  createResource,
  createRoot,
  createSignal,
  onCleanup,
  onMount,
  untrack,
} from "solid-js";
import { createStore, produce, reconcile, unwrap } from "solid-js/store";

export function counter() {
  const [count, setCount] = createSignal(0);
  const doubled = createMemo(() => count() * 2);

  // createEffect with the previous value: the whole callback tracks.
  createEffect<number>((previous) => {
    const next = count();
    if (previous !== undefined) console.log(previous, next);
    return next;
  }, 0);

  batch(() => {
    setCount(1);
    setCount(2);
  });

  return { count, doubled, stop: () => setCount(untrack(count)) };
}

export function lifecycle() {
  return createRoot((dispose) => {
    const [width, setWidth] = createSignal(0);
    const onResize = () => setWidth(window.innerWidth);

    onMount(() => {
      window.addEventListener("resize", onResize);
      onResize();
    });

    onCleanup(() => window.removeEventListener("resize", onResize));
    return { width, dispose };
  });
}

export type Todo = { id: string; title: string; done: boolean };

export function todoStore() {
  const [state, setState] = createStore({
    todos: [] as Todo[],
    filter: "all" as "all" | "done",
  });

  // Path setter: the 1.9 form.
  setState("todos", (todos) => [
    ...todos,
    { id: "1", title: "Write the example", done: false },
  ]);
  setState("todos", 0, "done", true);

  // produce for a multi-write draft.
  setState(produce((draft) => {
    draft.todos.push({ id: "2", title: "Review it", done: false });
  }));

  // reconcile for a server payload.
  setState(reconcile({ todos: [], filter: "all" }));

  const plain = unwrap(state);
  return { state, setState, plain };
}

export function userResource() {
  const [userId, setUserId] = createSignal("1");
  const [user] = createResource(userId, async (id) => {
    const response = await fetch(`/api/users/${id}`);
    return (await response.json()) as { id: string; name: string };
  });

  return { userId, setUserId, user };
}
