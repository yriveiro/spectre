/**
 * Solid 2.0 reactivity. Compiled only; not executed.
 *
 * Every call is the release-candidate API. `createEffect` is split, store
 * setters are draft-first, and a setter write lands after the microtask flush.
 */
import {
  action,
  affects,
  createEffect,
  createMemo,
  createOptimisticStore,
  createProjection,
  createSignal,
  createStore,
  flush,
  isPending,
  latest,
  onSettled,
  refresh,
  snapshot,
  until,
} from "solid-js";

export function counter() {
  const [count, setCount] = createSignal(0);
  const doubled = createMemo(() => count() * 2);
  const [tripled] = createSignal(() => count() * 3);

  createEffect(
    () => count(),
    (value, previous) => {
      console.log(previous, value);
    },
  );

  setCount(1);
  // The write is staged until the batch flushes.
  flush();

  return { count, doubled, tripled };
}

export function lifecycle() {
  const [width, setWidth] = createSignal(0);

  onSettled(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    onResize();
    return () => window.removeEventListener("resize", onResize);
  });

  return width;
}

export type Todo = { id: string; title: string; done: boolean };

export function todoStore() {
  const [state, setState] = createStore({
    todos: [] as Todo[],
    filter: "all" as "all" | "done",
  });

  setState((draft) => {
    draft.todos.push({ id: "1", title: "Write the example", done: false });
  });
  setState((draft) => {
    draft.todos[0]!.done = true;
  });

  const plain = snapshot(state);
  return { state, setState, plain };
}

export function derived() {
  const [todos, setTodos] = createStore({
    list: [] as Todo[],
  });

  const [summary] = createStore(
    (draft) => {
      draft.total = todos.list.length;
    },
    { total: 0 },
  );

  const projection = createProjection(
    () => ({ total: todos.list.length, done: todos.list.filter((todo) => todo.done).length }),
    { total: 0, done: 0 },
  );

  affects(projection);
  void refresh(projection);

  const pending = isPending(() => projection.total);
  const shown = latest(() => summary.total);
  const settled = until(() => projection.total);

  return { todos, setTodos, summary, projection, pending, shown, settled };
}

export function optimistic() {
  const [todos, setTodos] = createStore({ list: [] as Todo[] });
  const [optimistic, setOptimistic] = createOptimisticStore({ list: [] as Todo[] });

  const addTodo = action(function* (todo: Todo) {
    setOptimistic((draft) => {
      draft.list.push(todo);
    });

    yield Promise.resolve();

    setTodos((draft) => {
      draft.list.push(todo);
    });
  });

  return { todos, optimistic, addTodo };
}
