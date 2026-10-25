import { createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import { render } from "@solidjs/web";

const [count, setCount] = createSignal(0);
const [state, setState] = createStore({ count: 0 });

render(() => <button onClick={() => setCount(count() + 1)}>{count()}</button>, document.body);

export { setState, state };
