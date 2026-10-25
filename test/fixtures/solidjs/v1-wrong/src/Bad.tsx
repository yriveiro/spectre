import { createSignal, Loading, onSettled } from "solid-js";

const [count] = createSignal(0);

onSettled(() => {
  console.log("2.0 only");
});

export function Bad() {
  return (
    <Loading fallback={<p>Loading</p>}>
      <p>{count()}</p>
    </Loading>
  );
}
